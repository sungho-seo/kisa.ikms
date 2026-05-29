import sqlite3
import os
import json
import shutil

def reset_all_contents():
    project_root = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(project_root, 'search_index.db')
    
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return

    # 1. Reset Database Tables
    print("Resetting database tables...")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Tables to truncate
        tables = [
            'docs_fts', 
            'chat_history', 
            'chat_sessions', 
            'chat_agents',
            'sharing_group_members', 
            'sharing_groups'
        ]
        
        for table in tables:
            try:
                cursor.execute(f"DELETE FROM {table}")
                print(f" - Emptied table: {table}")
            except sqlite3.OperationalError:
                print(f" - Table {table} does not exist or error deleting. Skipping.")

        # Special case for categories: keep root 'General' folder
        try:
            cursor.execute("DELETE FROM categories")
            cursor.execute("INSERT OR IGNORE INTO categories (id, name, parent_id, visibility) VALUES (1, 'General', NULL, 'public')")
            print(" - Emptied table: categories and recreated root 'General'")
        except sqlite3.OperationalError:
            print(" - Table categories does not exist or error deleting. Skipping.")

        # Reset sequences (AUTOINCREMENT) so id starts from 1 again
        cursor.execute("DELETE FROM sqlite_sequence WHERE name IN ('chat_history', 'chat_agents', 'sharing_groups', 'categories')")

        conn.commit()
        print("Database reset completed.\n")
    except Exception as e:
        print(f"Error resetting database: {e}")
        conn.rollback()
    finally:
        conn.close()

    # 2. Clear File System contents
    print("Clearing file system contents...")
    
    # Empty docs/
    docs_dir = os.path.join(project_root, 'docs')
    if os.path.exists(docs_dir):
        for filename in os.listdir(docs_dir):
            file_path = os.path.join(docs_dir, filename)
            try:
                if os.path.isfile(file_path):
                    os.unlink(file_path)
            except Exception as e:
                print(f"Failed to delete {file_path}: {e}")
        print(" - Emptied 'docs/' directory.")
        
    # Empty trees/
    trees_dir = os.path.join(project_root, 'trees')
    if os.path.exists(trees_dir):
        for filename in os.listdir(trees_dir):
            file_path = os.path.join(trees_dir, filename)
            try:
                if os.path.isfile(file_path):
                    os.unlink(file_path)
            except Exception as e:
                print(f"Failed to delete {file_path}: {e}")
        print(" - Emptied 'trees/' directory.")

    # Reset status.json
    status_file = os.path.join(project_root, 'status.json')
    try:
        with open(status_file, 'w', encoding='utf-8') as f:
            json.dump({}, f)
        print(" - Cleared 'status.json'.")
    except Exception as e:
        print(f"Failed to reset status.json: {e}")

    print("\nAll user contents successfully reset to initial state!")

if __name__ == "__main__":
    confirm = input("This will permanently delete all user documents, chat history, groups, and agents. Are you absolutely sure? (y/n): ")
    if confirm.lower() == 'y':
        reset_all_contents()
    else:
        print("Reset cancelled.")
