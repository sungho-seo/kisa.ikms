import os
import sys
import tempfile
import subprocess
import shutil
import uuid
from typing import List, Dict

OUTPUTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "agent_outputs")
TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "agent_templates")
VENVS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "agent_venvs")

os.makedirs(OUTPUTS_DIR, exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)
os.makedirs(VENVS_DIR, exist_ok=True)

ACTIVE_PROCESSES = {}

def safe_decode(b: bytes) -> str:
    if not b:
        return ""
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return b.decode("cp949")
        except UnicodeDecodeError:
            return b.decode("utf-8", errors="replace")

def ensure_agent_venv(agent_id: int):
    """Ensures a virtual environment exists for the given agent_id and returns (venv_path, python_exe)."""
    agent_venv_path = os.path.join(VENVS_DIR, str(agent_id))
    python_exe = os.path.join(agent_venv_path, "Scripts", "python.exe") if os.name == 'nt' else os.path.join(agent_venv_path, "bin", "python")
    
    if not os.path.exists(python_exe):
        print(f"[Sandbox] Creating new venv for agent {agent_id} at {agent_venv_path}...")
        subprocess.run([sys.executable, "-m", "venv", agent_venv_path], capture_output=True)
    return agent_venv_path, python_exe

def execute_terminal_command(agent_id: int, command: str) -> Dict[str, str]:
    """Executes an arbitrary shell command safely inside the agent's virtual environment context."""
    if not command.strip():
        return {"stdout": "", "stderr": "", "success": False, "error": "Empty command"}
        
    command_lower = command.lower()
    dangerous_patterns = [
        "..",  # 상위 디렉토리 이동 금지 (Path traversal)
        "c:\\", "c:/", "d:\\", "d:/", "e:\\", "e:/",  # 절대 경로 접근 금지
        "%userprofile%", "%appdata%", "%systemroot%", "%windir%"  # 환경변수 치환 접근 금지
    ]
    for pattern in dangerous_patterns:
        if pattern in command_lower:
            return {"stdout": "", "stderr": f"❌ [보안 위반] 명령어 내에 허용되지 않는 구문('{pattern}')이 감지되었습니다.\n터미널 명령은 해당 에이전트의 가상환경(venv) 내부 영역으로만 엄격하게 제한됩니다.", "success": False}
            
    import re
    if re.search(r'(^|[\s<|>;=&"\'])(/|~/)', command):
        return {"stdout": "", "stderr": "❌ [보안 위반] 리눅스 절대 경로(/ 또는 ~/) 직접 접근이 차단되었습니다.\n샌드박스 내부의 상대 경로만 사용할 수 있습니다.", "success": False}
        
    command_parts = re.split(r'\s+', command.strip())
    if command_parts:
        import os
        base_cmd = os.path.basename(command_parts[0].lower())
        interactive_cmds = {"vi", "vim", "nano", "emacs", "top", "htop", "less", "more", "screen", "tmux", "ssh", "ftp", "sftp", "telnet", "nc"}
        if base_cmd in interactive_cmds:
            return {"stdout": "", "stderr": f"❌ [보안 위반] 대화형 프로그램('{base_cmd}')은 터미널에 멈춤(Hang)을 유발하므로 샌드박스 API에서 실행할 수 없습니다.", "success": False}
        if base_cmd in ["python", "python3", "bash", "sh", "cmd", "powershell"] and len(command_parts) == 1:
            return {"stdout": "", "stderr": f"❌ [보안 위반] 명령행 인자가 없는 대화형 프롬프트('{base_cmd}')는 샌드박스를 멈추게 하므로 차단되었습니다.", "success": False}
        if "tail -f" in command_lower:
            return {"stdout": "", "stderr": "❌ [보안 위반] 실시간 출력을 대기하는 명령어('tail -f')는 터미널에 멈춤을 유발하므로 차단되었습니다.", "success": False}
            
    agent_venv_path, python_exe = ensure_agent_venv(agent_id)
    
    # Configure env to use venv
    env = os.environ.copy()
    env["VIRTUAL_ENV"] = agent_venv_path
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    
    bin_dir = os.path.join(agent_venv_path, "Scripts") if os.name == 'nt' else os.path.join(agent_venv_path, "bin")
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    
    try:
        process = subprocess.Popen(
            command,
            cwd=agent_venv_path,
            shell=True,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        ACTIVE_PROCESSES[agent_id] = process
        
        stdout_b, stderr_b = process.communicate(timeout=180)
        
        return {
            "stdout": safe_decode(stdout_b),
            "stderr": safe_decode(stderr_b),
            "success": process.returncode == 0
        }
    except subprocess.TimeoutExpired:
        process.kill()
        stdout_b, stderr_b = process.communicate()
        return {"stdout": safe_decode(stdout_b), "stderr": "Command execution timed out after 180 seconds.\n" + safe_decode(stderr_b), "success": False}
    except Exception as e:
        return {"stdout": "", "stderr": str(e), "success": False}
    finally:
        ACTIVE_PROCESSES.pop(agent_id, None)

def cancel_sandbox_execution(agent_id: int) -> bool:
    """Cancels the currently running sandbox execution for the given agent."""
    process = ACTIVE_PROCESSES.get(agent_id)
    if process and process.poll() is None:
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)], capture_output=True)
            else:
                process.kill()
            return True
        except Exception:
            pass
    return False

def execute_agent_code(python_code: str, input_file_paths: List[str], user_prompt: str = "", agent_id: int = None, custom_args: List[str] = None) -> Dict:
    """
    Executes an agent's python code in an isolated temporary directory.
    If input_file_paths are provided, they are copied into the temp dir, and their
    basenames are passed as sys.argv[1:] to the script.
    
    Returns:
    {
        "stdout": str,
        "stderr": str,
        "success": bool,
        "output_files": [{"name": filename, "url": "/static/agent_outputs/..."}]
    }
    """
    if not python_code.strip():
        return {"stdout": "", "stderr": "", "success": True, "output_files": []}
        
    python_exe = sys.executable
    pip_exe = [sys.executable, "-m", "pip"]
    
    if agent_id is not None:
        agent_venv_path, python_exe = ensure_agent_venv(agent_id)
        pip_exe = [python_exe, "-m", "pip"]
            
    session_uuid = str(uuid.uuid4())
    results_files = []
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Copy input files
        copied_args = []
        for f in input_file_paths:
            basename = os.path.basename(f)
            dest = os.path.join(tmpdir, basename)
            shutil.copy2(f, dest)
            copied_args.append(basename)
            
        # Write the python script
        script_path = os.path.join(tmpdir, "agent_script.py")
        with open(script_path, "w", encoding="utf-8") as rf:
            rf.write(python_code)
            
        # Execute
        import re
        COMMON_PACKAGE_ALIASES = {
            "PIL": "Pillow",
            "cv2": "opencv-python",
            "bs4": "beautifulsoup4",
            "sklearn": "scikit-learn",
            "yaml": "PyYAML",
            "dotenv": "python-dotenv",
            "jwt": "PyJWT",
            "dateutil": "python-dateutil",
            "docx": "python-docx",
            "pptx": "python-pptx",
            "win32com": "pywin32",
            "fitz": "PyMuPDF",
            "hwp5": "pyhwp",
            "mysql": "mysql-connector-python",
            "openpyxl": "openpyxl",
            "pandas": "pandas",
            "requests": "requests"
        }
        
        execution_logs = ""
        
        # ────────────── AST Pre-Parsing & Auto-Installer ──────────────
        import ast
        import importlib.util
        
        try:
            tree = ast.parse(python_code)
            required_modules = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        required_modules.add(alias.name.split('.')[0])
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        required_modules.add(node.module.split('.')[0])
                        
            # Filter standard library safely
            if hasattr(sys, 'stdlib_module_names'):
                stdlib = sys.stdlib_module_names
            else:
                stdlib = {"os", "sys", "json", "math", "datetime", "time", "re", "csv", "collections", "itertools", "io", "subprocess", "random", "string", "base64", "hashlib", "urllib", "sqlite3", "uuid"}
                
            external_modules = required_modules - stdlib
            
            for mod in external_modules:
                package_name = COMMON_PACKAGE_ALIASES.get(mod, mod)
                # Check if it's importable natively in the TARGET process space
                check_cmd = subprocess.run([python_exe, "-c", f"import {mod}"], capture_output=True)
                
                if check_cmd.returncode != 0 and mod not in ["__future__", "builtins"]:
                    execution_logs += f"💡 [AOT 의존성 스캐너] 사전 감지: '{package_name}' 패키지가 가상환경에 없습니다. 설치를 시작합니다...\n"
                    install_process = subprocess.run(pip_exe + ["install", package_name], capture_output=True, text=True, encoding="utf-8", errors="replace")
                    
                    if install_process.returncode == 0:
                        execution_logs += f"✅ [AOT 의존성 스캐너] '{package_name}' 패키지 가상환경 설치 완료!\n\n"
                    else:
                        execution_logs += f"❌ [AOT 의존성 스캐너] '{package_name}' 필수 패키지 설치 실패 (Syntax/Network Error):\n{install_process.stderr}\n\n"
        except SyntaxError as e:
            execution_logs += f"⚠️ [AOT 의존성 스캐너] 제공된 파이썬 코드 문법 오류 발생 (의존성 검사 스킵됨):\n{str(e)}\n\n"
        except Exception as e:
            execution_logs += f"⚠️ [AOT 의존성 스캐너] 사전 의존성 스캐너 내부 오류:\n{str(e)}\n\n"
        # ──────────────────────────────────────────────────────────────
        
        max_retries = 3 # Reduced slightly since AOT handles initial state perfectly
        retries = 0
        
        while retries <= max_retries:
            try:
                # We use the target python executable
                filtered_copied_args = []
                for basename in copied_args:
                    # If user manually included the filename in custom_args (e.g. --csv list.csv), avoid positional injection
                    if custom_args and basename in " ".join(custom_args):
                        continue
                    filtered_copied_args.append(basename)
                
                cmd = [python_exe, "agent_script.py"] + (custom_args or []) + filtered_copied_args
                
                # Pass user prompt and allow internal pageindex imports
                sandbox_env = os.environ.copy()
                sandbox_env["PYTHONPATH"] = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                sandbox_env["AGENT_USER_PROMPT"] = user_prompt
                sandbox_env["PYTHONIOENCODING"] = "utf-8"
                sandbox_env["PYTHONUTF8"] = "1"
                
                process = subprocess.Popen(
                    cmd,
                    cwd=tmpdir,
                    env=sandbox_env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                if agent_id is not None:
                    ACTIVE_PROCESSES[agent_id] = process
                
                try:
                    stdout_b, stderr_b = process.communicate(timeout=120)
                finally:
                    if agent_id is not None:
                        ACTIVE_PROCESSES.pop(agent_id, None)
                        
                success = process.returncode == 0
                stdout = safe_decode(stdout_b)
                stderr = safe_decode(stderr_b)
                
                # Check for missing imports
                if not success and "No module named" in stderr:
                    match = re.search(r"No module named '([^']+)'", stderr)
                    if match:
                        module_name = match.group(1).split('.')[0] # get root module
                        package_name = COMMON_PACKAGE_ALIASES.get(module_name, module_name)
                        
                        execution_logs += f"💡 [샌드박스 엔진] 누락된 모듈 감지: '{module_name}'. 원격 패키지 '{package_name}' 자동 설치를 시도합니다...\n"
                        install_process = subprocess.run([sys.executable, "-m", "pip", "install", package_name, "--break-system-packages"], capture_output=True, text=True, encoding="utf-8", errors="replace")
                        
                        if install_process.returncode == 0:
                            execution_logs += f"✅ [샌드박스 엔진] '{package_name}' 자동 설치 완료. 코드를 재실행합니다...\n\n"
                            retries += 1
                            continue # Try running the script again
                        else:
                            execution_logs += f"❌ [샌드박스 엔진] '{package_name}' 설치에 실패했습니다:\n{install_process.stderr}\n\n"
                            stderr = execution_logs + stderr
                            break # Exit loop if install failed
                            
                stdout = execution_logs + stdout
                if execution_logs and not success:
                    stderr = execution_logs + stderr
                
                # Verify if process was killed manually
                if process.returncode != 0 and (process.returncode == -15 or process.returncode == -9 or str(process.returncode) == '1' or str(process.returncode) == '137'):
                    if 'taskkill' in stderr or not stderr:
                        stderr = "❌ 사용자에 의해 강제 종료되었습니다."
                        success = False

                break # Exit loop if success, or failure isn't missing module
                
            except subprocess.TimeoutExpired:
                process.kill()
                stdout_data, stderr_data = process.communicate()
                success = False
                stdout = execution_logs + safe_decode(stdout_data)
                stderr = "Execution timed out after 120 seconds.\n" + safe_decode(stderr_data)
                break
            except Exception as e:
                success = False
                stdout = execution_logs
                stderr = str(e)
                break
            
        # Collect generated output files
        for item in os.listdir(tmpdir):
            if item == "agent_script.py" or item in copied_args:
                continue
            # It's a new file generated by the agent!
            generated_path = os.path.join(tmpdir, item)
            if os.path.isfile(generated_path):
                # Copy it to our static/agent_outputs dir
                safe_name = f"{session_uuid}_{item}"
                final_dest = os.path.join(OUTPUTS_DIR, safe_name)
                shutil.copy2(generated_path, final_dest)
                results_files.append({
                    "name": item,
                    "url": f"/static/agent_outputs/{safe_name}"
                })
                
    return {
        "stdout": stdout,
        "stderr": stderr,
        "success": success,
        "output_files": results_files
    }


async def execute_agent_code_async(python_code: str, input_file_paths: List[str], user_prompt: str = "", custom_args: List[str] = None) -> Dict:
    """
    Executes an agent's python code in an isolated temporary directory.
    If input_file_paths are provided, they are copied into the temp dir, and their
    basenames are passed as sys.argv[1:] to the script.
    
    Returns:
    {
        "stdout": str,
        "stderr": str,
        "success": bool,
        "output_files": [{"name": filename, "url": "/static/agent_outputs/..."}]
    }
    """
    if not python_code.strip():
        return {"stdout": "", "stderr": "", "success": True, "output_files": []}
        
    session_uuid = str(uuid.uuid4())
    results_files = []
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Copy input files
        copied_args = []
        for f in input_file_paths:
            basename = os.path.basename(f)
            dest = os.path.join(tmpdir, basename)
            shutil.copy2(f, dest)
            copied_args.append(basename)
            
        # Write the python script
        script_path = os.path.join(tmpdir, "agent_script.py")
        with open(script_path, "w", encoding="utf-8") as rf:
            rf.write(python_code)
            
        # Execute
        import re
        COMMON_PACKAGE_ALIASES = {
            "PIL": "Pillow",
            "cv2": "opencv-python",
            "bs4": "beautifulsoup4",
            "sklearn": "scikit-learn",
            "yaml": "PyYAML",
            "dotenv": "python-dotenv",
            "jwt": "PyJWT",
            "dateutil": "python-dateutil",
            "docx": "python-docx",
            "pptx": "python-pptx",
            "win32com": "pywin32",
            "fitz": "PyMuPDF",
            "hwp5": "pyhwp",
            "mysql": "mysql-connector-python",
            "openpyxl": "openpyxl",
            "pandas": "pandas",
            "requests": "requests"
        }
        
        execution_logs = ""
        
        # ────────────── AST Pre-Parsing & Auto-Installer ──────────────
        import ast
        import importlib.util
        
        try:
            tree = ast.parse(python_code)
            required_modules = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        required_modules.add(alias.name.split('.')[0])
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        required_modules.add(node.module.split('.')[0])
                        
            # Filter standard library safely
            if hasattr(sys, 'stdlib_module_names'):
                stdlib = sys.stdlib_module_names
            else:
                stdlib = {"os", "sys", "json", "math", "datetime", "time", "re", "csv", "collections", "itertools", "io", "subprocess", "random", "string", "base64", "hashlib", "urllib", "sqlite3", "uuid"}
                
            external_modules = required_modules - stdlib
            
            for mod in external_modules:
                package_name = COMMON_PACKAGE_ALIASES.get(mod, mod)
                # Check if it's importable natively in this process space
                spec = importlib.util.find_spec(mod)
                # Explicit check against common Python built-ins that don't always appear in stdlib sets securely
                if spec is None and mod not in ["__future__", "builtins"]:
                    execution_logs += f"💡 [AOT 의존성 스캐너] 사전 감지: '{package_name}' 패키지가 환경에 없습니다. 백그라운드 설치를 시작합니다...\n"
                    
                    import asyncio
                    install_process = await asyncio.create_subprocess_exec(
                        sys.executable, "-m", "pip", "install", package_name, "--break-system-packages",
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                    )
                    i_out = b""
                    i_err = b""
                    try:
                        i_out, i_err = await install_process.communicate()
                    except asyncio.CancelledError:
                        install_process.kill()
                        await install_process.wait()
                        raise
                    except Exception:
                        pass
                    class DummyP: pass
                    install_process_ret = DummyP()
                    install_process_ret.returncode = install_process.returncode
                    install_process_ret.stderr = i_err.decode("utf-8", errors="replace") if i_err else ""
                    install_process = install_process_ret

                    
                    if install_process.returncode == 0:
                        execution_logs += f"✅ [AOT 의존성 스캐너] '{package_name}' 패키지 사전 설치 완료!\n\n"
                        # Persist deeply to requirements.txt
                        req_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "requirements.txt")
                        try:
                            with open(req_path, "r", encoding="utf-8") as f:
                                existing_reqs = f.read().splitlines()
                        except FileNotFoundError:
                            existing_reqs = []
                            
                        # Soft-check to avoid duplicate persistence tags
                        if not any(package_name.lower() in line.lower() for line in existing_reqs):
                            with open(req_path, "a", encoding="utf-8") as f:
                                f.write(f"\n{package_name} # Auto-injected by AOT AST Sandbox Dependency Resolver")
                    else:
                        execution_logs += f"❌ [AOT 의존성 스캐너] '{package_name}' 필수 패키지 설치 실패 (Syntax/Network Error):\n{install_process.stderr}\n\n"
        except SyntaxError as e:
            execution_logs += f"⚠️ [AOT 의존성 스캐너] 제공된 파이썬 코드 문법 오류 발생 (의존성 검사 스킵됨):\n{str(e)}\n\n"
        except Exception as e:
            execution_logs += f"⚠️ [AOT 의존성 스캐너] 사전 의존성 스캐너 내부 오류:\n{str(e)}\n\n"
        # ──────────────────────────────────────────────────────────────
        
        max_retries = 3 # Reduced slightly since AOT handles initial state perfectly
        retries = 0
        
        while retries <= max_retries:
            try:
                # We use the current python executable
                cmd = [sys.executable, "agent_script.py"] + copied_args + (custom_args or [])
                
                # Pass user prompt and allow internal pageindex imports
                sandbox_env = os.environ.copy()
                sandbox_env["PYTHONPATH"] = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                sandbox_env["AGENT_USER_PROMPT"] = user_prompt
                
                
                import asyncio
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=tmpdir,
                    env=sandbox_env,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout_bytes = b""
                stderr_bytes = b""
                try:
                    stdout_bytes, stderr_bytes = await asyncio.wait_for(process.communicate(), timeout=120)
                except asyncio.CancelledError:
                    process.kill()
                    await process.wait()
                    raise
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
                    class DummyE:
                        stdout = b""
                    e = DummyE()
                    raise subprocess.TimeoutExpired(cmd, 120, output=b"")
                
                class DummyRes: pass
                process_res = DummyRes()
                process_res.returncode = process.returncode
                process_res.stdout = stdout_bytes.decode("utf-8", errors="replace") if stdout_bytes else ""
                process_res.stderr = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else ""
                process = process_res

                success = process.returncode == 0
                stdout = process.stdout
                stderr = process.stderr
                
                # Check for missing imports
                if not success and "No module named" in stderr:
                    match = re.search(r"No module named '([^']+)'", stderr)
                    if match:
                        module_name = match.group(1).split('.')[0] # get root module
                        package_name = COMMON_PACKAGE_ALIASES.get(module_name, module_name)
                        
                        execution_logs += f"💡 [샌드박스 엔진] 누락된 모듈 감지: '{module_name}'. 원격 패키지 '{package_name}' 자동 설치를 시도합니다...\n"
                        
                        import asyncio
                        install_process = await asyncio.create_subprocess_exec(
                            sys.executable, "-m", "pip", "install", package_name, "--break-system-packages",
                            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                        )
                        i_out = b""
                        i_err = b""
                        try:
                            i_out, i_err = await install_process.communicate()
                        except asyncio.CancelledError:
                            install_process.kill()
                            await install_process.wait()
                            raise
                        except Exception:
                            pass
                        class DummyP: pass
                        install_process_ret = DummyP()
                        install_process_ret.returncode = install_process.returncode
                        install_process_ret.stderr = i_err.decode("utf-8", errors="replace") if i_err else ""
                        install_process = install_process_ret

                        
                        if install_process.returncode == 0:
                            execution_logs += f"✅ [샌드박스 엔진] '{package_name}' 자동 설치 완료. 코드를 재실행합니다...\n\n"
                            retries += 1
                            continue # Try running the script again
                        else:
                            execution_logs += f"❌ [샌드박스 엔진] '{package_name}' 설치에 실패했습니다:\n{install_process.stderr}\n\n"
                            stderr = execution_logs + stderr
                            break # Exit loop if install failed
                            
                stdout = execution_logs + stdout
                if execution_logs and not success:
                    stderr = execution_logs + stderr
                break # Exit loop if success, or failure isn't missing module
                
            except subprocess.TimeoutExpired as e:
                success = False
                stdout = execution_logs + (e.stdout.decode("utf-8") if e.stdout else "")
                stderr = "Execution timed out after 120 seconds."
                break
            except Exception as e:
                success = False
                stdout = execution_logs
                stderr = str(e)
                break
            
        # Collect generated output files
        for item in os.listdir(tmpdir):
            if item == "agent_script.py" or item in copied_args:
                continue
            # It's a new file generated by the agent!
            generated_path = os.path.join(tmpdir, item)
            if os.path.isfile(generated_path):
                # Copy it to our static/agent_outputs dir
                safe_name = f"{session_uuid}_{item}"
                final_dest = os.path.join(OUTPUTS_DIR, safe_name)
                shutil.copy2(generated_path, final_dest)
                results_files.append({
                    "name": item,
                    "url": f"/static/agent_outputs/{safe_name}"
                })
                
    return {
        "stdout": stdout,
        "stderr": stderr,
        "success": success,
        "output_files": results_files
    }
