import os
import subprocess
import shutil
import fitz  # PyMuPDF

def get_libreoffice_path():
    """Find LibreOffice soffice.exe on Windows/Linux."""
    if os.name == 'nt':
        # Check specific common paths on Windows
        possible_paths = [
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"
        ]
        # Also check if it's in PATH simply as 'soffice'
        if shutil.which("soffice"):
            return "soffice"

        for p in possible_paths:
            if os.path.exists(p):
                return p
        
        # Fallback to just soffice, hoping it might somehow work
        return "soffice"
    else:
        # Linux/Mac
        return "soffice"

def convert_image_to_pdf(input_path: str, output_path: str) -> bool:
    try:
        doc = fitz.open(input_path)
        pdfbytes = doc.convert_to_pdf()
        pdf = fitz.open("pdf", pdfbytes)
        pdf.save(output_path)
        pdf.close()
        doc.close()
        return True
    except Exception as e:
        print(f"Error converting image to PDF: {e}")
        return False

def convert_text_to_pdf(input_path: str, output_path: str) -> bool:
    try:
        with open(input_path, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read()
        
        doc = fitz.open()
        
        # Calculate pagination manually or just insert raw text with auto-pagination
        # PyMuPDF's insert_text doesn't auto-paginate easily. insert_textbox does, but only within a rect on a single page.
        # Simple trick: Split text by lines and insert onto pages
        font_size = 11
        lines = text.split('\n')
        
        # Load PyMuPDF's built-in Korean/CJK font to prevent missing characters on Linux
        font_korea = fitz.Font("korea")
        
        page = doc.new_page()
        page.insert_font(fontname="ko", fontbuffer=font_korea.buffer)
        p = fitz.Point(30, 50)
        
        # A4 size is approx 595 x 842 points
        for line in lines:
            # Wrap long lines or simply insert (this is basic text rendering)
            page.insert_text(p, line, fontname="ko", fontsize=font_size)
            p.y += font_size * 1.5
            
            if p.y > 800:  # Bottom of A4 page
                page = doc.new_page()
                page.insert_font(fontname="ko", fontbuffer=font_korea.buffer)
                p = fitz.Point(30, 50)
                
        doc.save(output_path)
        doc.close()
        return True
    except Exception as e:
        print(f"Error converting text to PDF: {e}")
        return False

def convert_with_libreoffice(input_path: str, output_path: str) -> bool:
    """Uses LibreOffice Headless to convert MS Office / HWP to PDF."""
    import tempfile
    
    import pathlib
    
    soffice_path = get_libreoffice_path()
    outdir = os.path.dirname(output_path)
    
    ext = os.path.splitext(input_path)[1].lower()
    
    # Create temp directory inside outdir (DOCS_DIR) instead of /tmp.
    # Linux environments (Snap, AppArmor, Flatpak) aggressively restrict LibreOffice
    # from reading/writing to /tmp, which causes "source file could not be loaded".
    with tempfile.TemporaryDirectory(dir=outdir) as profile_dir:
        profile_uri = pathlib.Path(profile_dir).as_uri()
        env_arg = f"-env:UserInstallation={profile_uri}"
        
        # Very important: Copy input file to a strictly ASCII name in the temp dir
        # Headless LibreOffice is notorious for failing to load files with CJK characters
        # if the Linux server locale is not properly configured (e.g., POSIX/C locale).
        safe_ascii_input = os.path.join(profile_dir, f"input_file{ext}")
        shutil.copy2(input_path, safe_ascii_input)
        
        cmd = [
            soffice_path,
            env_arg,
            "--headless",
        ]
        
        if ext in ['.hwp', '.hwpx']:
            cmd.extend([
                "--convert-to", "pdf:writer_pdf_Export",
                "--outdir", profile_dir,
                safe_ascii_input
            ])
        else:
            cmd.extend([
                "--convert-to", "pdf",
                "--outdir", profile_dir,
                safe_ascii_input
            ])
        
        try:
            # Run conversion
            result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
            if result.returncode != 0:
                msg = f"LibreOffice conversion failed (code {result.returncode}):\nSTDERR: {result.stderr}\nSTDOUT: {result.stdout}"
                print(msg)
                raise RuntimeError(msg)
            
            # LibreOffice generates the output file with the same basename but .pdf extension in outdir
            generated_pdf = os.path.join(profile_dir, "input_file.pdf")
            
            # If output_path differs from what LibreOffice created, rename/move it
            if os.path.exists(generated_pdf):
                if generated_pdf != output_path:
                    shutil.move(generated_pdf, output_path)
                return True
            else:
                msg = f"LibreOffice finished but output PDF was not found at {generated_pdf}.\nSTDERR: {result.stderr}\nSTDOUT: {result.stdout}"
                print(msg)
                raise RuntimeError(msg)
                
        except subprocess.TimeoutExpired:
            raise RuntimeError("LibreOffice conversion timed out.")
        except FileNotFoundError:
            raise RuntimeError(f"LibreOffice executable not found at '{soffice_path}'. Please install LibreOffice or set it in PATH.")
        except Exception as e:
            if isinstance(e, RuntimeError):
                raise
            raise RuntimeError(f"Error executing libreoffice: {e}")

def convert_hwp_with_com(input_path: str, output_path: str) -> bool:
    """Uses Hancom Office COM Automation to convert HWP/HWPX to PDF."""
    try:
        import win32com.client
        import os
        hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
        hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        
        abs_in = os.path.abspath(input_path)
        abs_out = os.path.abspath(output_path)
        
        hwp.Open(abs_in, "", "forceOoo:True")
        
        hwp.HAction.GetDefault("FileSaveAs_S", hwp.HParameterSet.HFileOpenSave.HSet)
        hwp.HParameterSet.HFileOpenSave.filename = abs_out
        hwp.HParameterSet.HFileOpenSave.Format = "PDF"
        hwp.HAction.Execute("FileSaveAs_S", hwp.HParameterSet.HFileOpenSave.HSet)
        
        hwp.Quit()
        return os.path.exists(abs_out)
    except ImportError as e:
        print(f"pywin32 import failed ({e}), falling back to LibreOffice.")
        return False
    except Exception as e:
        print(f"Error converting HWP via COM: {e}")
        try:
            if 'hwp' in locals() and hwp is not None:
                hwp.Quit()
        except Exception:
            pass
        return False

def convert_hwp_with_pyhwp(input_path: str, output_path: str) -> bool:
    """Uses pyhwp (hwp5odt) to convert HWP to ODT, then LibreOffice to PDF. (Linux/Mac)"""
    import tempfile
    import shutil
    import pathlib
    
    soffice_path = get_libreoffice_path()
    outdir = os.path.dirname(output_path)
    ext = os.path.splitext(input_path)[1].lower()
    
    with tempfile.TemporaryDirectory(dir=outdir) as profile_dir:
        safe_ascii_input = os.path.join(profile_dir, f"input_file{ext}")
        shutil.copy2(input_path, safe_ascii_input)
        
        odt_path = os.path.join(profile_dir, "output.odt")
        
        # 1. HWP to ODT via pyhwp
        cmd_hwp5odt = ["hwp5odt", safe_ascii_input, "--output", odt_path]
        try:
            res_odt = subprocess.run(cmd_hwp5odt, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
            if res_odt.returncode != 0:
                print(f"hwp5odt failed (code {res_odt.returncode}), attempting hwp5txt fallback...")
                # Fallback to hwp5txt due to RelaxNG validation failures common in newer HWP files
                txt_path = os.path.join(profile_dir, "output.txt")
                cmd_hwp5txt = ["hwp5txt", safe_ascii_input, "--output", txt_path]
                res_txt = subprocess.run(cmd_hwp5txt, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
                
                if res_txt.returncode == 0 and os.path.exists(txt_path):
                     # Successfully extracted plain text; convert it to PDF
                     return convert_text_to_pdf(txt_path, output_path)
                else:
                     raise RuntimeError(f"hwp5odt and hwp5txt both failed.\nhwp5odt STDERR: {res_odt.stderr}\nhwp5txt STDERR: {res_txt.stderr}")
        except FileNotFoundError:
            raise RuntimeError("hwp5odt / hwp5txt executable not found. Please install pyhwp (pip install pyhwp).")
            
        # 2. ODT to PDF via LibreOffice
        profile_uri = pathlib.Path(profile_dir).as_uri()
        env_arg = f"-env:UserInstallation={profile_uri}"
        
        cmd_soffice = [
            soffice_path,
            env_arg,
            "--headless",
            "--convert-to", "pdf",
            "--outdir", profile_dir,
            odt_path
        ]
        res_soffice = subprocess.run(cmd_soffice, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
        
        if res_soffice.returncode != 0:
            raise RuntimeError(f"LibreOffice ODT->PDF failed (code {res_soffice.returncode}):\nSTDERR: {res_soffice.stderr}\nSTDOUT: {res_soffice.stdout}")
            
        generated_pdf = os.path.join(profile_dir, "output.pdf")
        if os.path.exists(generated_pdf):
            if generated_pdf != output_path:
                shutil.move(generated_pdf, output_path)
            return True
        else:
            raise RuntimeError(f"LibreOffice finished but output PDF was not found at {generated_pdf}.\nSTDERR: {res_soffice.stderr}\nSTDOUT: {res_soffice.stdout}")

def convert_hwp_with_api(input_path: str, output_path: str) -> bool:
    """Uses a local API to convert HWP/HWPX to PDF."""
    import requests
    url = "http://localhost:8800/convert"
    try:
        with open(input_path, "rb") as f:
            files = {"file": f}
            data = {"output_format": "pdf"}
            response = requests.post(url, files=files, data=data, timeout=300)
            
        if response.status_code == 200:
            with open(output_path, "wb") as f_out:
                f_out.write(response.content)
            return True
        else:
            print(f"HWP API Conversion Error: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"HWP API Request Failed: {e}")
        return False

def convert_to_pdf(input_path: str, output_path: str) -> bool:
    """
    Analyzes the input file extension and routes it to the correct converter.

    Returns True if successful, False otherwise.
    """
    ext = os.path.splitext(input_path)[1].lower()
    
    # Text types
    if ext in ['.txt', '.md', '.csv']:
        return convert_text_to_pdf(input_path, output_path)
        
    # Image types
    elif ext in ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp']:
        return convert_image_to_pdf(input_path, output_path)
        
    # Office types
    elif ext in ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.hwp', '.hwpx']:
        if ext in ['.hwp', '.hwpx']:
            if convert_hwp_with_api(input_path, output_path):
                return True
            # Fallback to standard LibreOffice for docx/xlsx/pptx, or if API fails
            print(f"API conversion failed for {input_path}, falling back to LibreOffice.")
        return convert_with_libreoffice(input_path, output_path)
        
    elif ext == '.pdf':
        # If it's already a PDF, just copy it
        if input_path != output_path:
            shutil.copy2(input_path, output_path)
        return True
    
    else:
        print(f"Unsupported extension for conversion: {ext}")
        return False
