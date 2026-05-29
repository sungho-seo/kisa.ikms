import os
import sys
import subprocess
import threading
import time
import uuid

class DaemonManager:
    """
    Manages background Python daemon processes for Autonomous Agents.
    Executes agents that run continuously (e.g. while True loops) and collects logs.
    """
    def __init__(self):
        self.daemons = {} # agent_id -> {"process": Popen, "log_path": str, "script_path": str, "reader": thread}
        import tempfile
        self.logs_dir = os.path.join(tempfile.gettempdir(), "pageindex_daemons")
        os.makedirs(self.logs_dir, exist_ok=True)

    def _reader_thread(self, agent_id, process, log_path):
        """Reads stdout/stderr natively and dumps it safely to the log file."""
        try:
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] --- DAEMON ENGINE: Process {process.pid} Started ---\n")
                
                # Iterate over lines incrementally
                for line in process.stdout:
                    f.write(line)
                    f.flush()
                
                # Process exited naturally or was killed
                process.wait()
                exit_code = process.returncode
                f.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] --- DAEMON ENGINE: Process exited with code {exit_code} ---\n")
        except Exception as e:
            pass # Thread ending

    def start_daemon(self, agent_id: int, python_code: str) -> bool:
        """Starts a background process for the given agent."""
        if self.is_running(agent_id):
            self.stop_daemon(agent_id)
            
        script_path = os.path.join(self.logs_dir, f"daemon_script_{agent_id}.py")
        log_path = os.path.join(self.logs_dir, f"daemon_{agent_id}.log")
        
        # Write the python code securely to a temp run script
        try:
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(python_code)
        except Exception as e:
            print(f"[Daemon Engine] Failed to write script for agent {agent_id}: {e}")
            return False
            
        try:
             # Ensure print(flush=True) globally so logs appear immediately
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            # Allow importing from pageindex-rag-app
            env["PYTHONPATH"] = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            
            # Start process intercepting stdout and stderr into one stream (stdout)
            cmd = [sys.executable, script_path]
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=os.path.dirname(self.logs_dir) # Use root dir as working dir
            )
            
            # Start reader daemon thread immediately
            t = threading.Thread(target=self._reader_thread, args=(agent_id, process, log_path), daemon=True)
            t.start()
            
            self.daemons[agent_id] = {
                "process": process,
                "log_path": log_path,
                "script_path": script_path,
                "thread": t
            }
            print(f"[Daemon Engine] Started daemon for agent {agent_id} (PID: {process.pid})")
            return True
            
        except Exception as e:
            print(f"[Daemon Engine] Failed to start daemon {agent_id}: {e}")
            return False

    def stop_daemon(self, agent_id: int) -> bool:
        """Gracefully or forcefully shuts down the daemon."""
        daemon = self.daemons.get(agent_id)
        if not daemon:
            return False
            
        process = daemon["process"]
        try:
            if process.poll() is None:
                # Still running, try terminate
                import sys
                if sys.platform == "win32":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True)
                else:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill() # Force kill if stubborn
            print(f"[Daemon Engine] Stopped daemon for agent {agent_id}")
            del self.daemons[agent_id]
            return True
        except Exception as e:
            print(f"[Daemon Engine] Error terminating daemon {agent_id}: {e}")
            return False
            
    def stop_all(self):
        """Kills all tracked daemons. Important during Uvicorn shutdown."""
        agent_ids = list(self.daemons.keys())
        for aid in agent_ids:
            self.stop_daemon(aid)
            
    def is_running(self, agent_id: int) -> bool:
        daemon = self.daemons.get(agent_id)
        if not daemon:
            return False
        return daemon["process"].poll() is None

    def get_status(self, agent_id: int) -> dict:
        """Get summarized status for UI."""
        running = self.is_running(agent_id)
        return {
            "running": running,
            "agent_id": agent_id
        }

    def get_logs(self, agent_id: int, max_lines=100) -> str:
        """Fetch the tail of the log file for the given agent."""
        log_path = os.path.join(self.logs_dir, f"daemon_{agent_id}.log")
        if not os.path.exists(log_path):
            return "No logs available yet."
            
        try:
            with open(log_path, "r", encoding="utf-8") as f:
                # Read all lines and take tail
                lines = f.readlines()
                if not lines:
                    return ""
                return "".join(lines[-max_lines:])
        except Exception as e:
            return f"Error reading logs: {e}"

# Global singleton
daemon_manager = DaemonManager()
