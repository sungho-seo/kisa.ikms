import sqlite3
import os
import argparse

def reset_usage(username=None):
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'search_index.db')
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        if username:
            # Find user id
            cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
            user = cursor.fetchone()
            if not user:
                print(f"User '{username}' not found. Please check the username.")
                conn.close()
                return
            
            user_id = user[0]
            cursor.execute("DELETE FROM token_usage WHERE user_id = ?", (user_id,))
            count = cursor.rowcount
            print(f"Deleted {count} usage records for user '{username}'.")
        else:
            # Prompt for confirmation if resetting all users
            confirm = input("Are you sure you want to reset usage statistics for ALL users? (y/n): ")
            if confirm.lower() != 'y':
                print("Reset cancelled.")
                conn.close()
                return
                
            cursor.execute("DELETE FROM token_usage")
            count = cursor.rowcount
            print(f"Deleted {count} usage records for all users.")

        conn.commit()
        print("Usage statistics reset successfully.")
    except Exception as e:
        print(f"An error occurred: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reset user usage statistics (Token Usage).")
    parser.add_argument("--username", "-u", type=str, help="Optional: Username to reset stats for. If omitted, resets for everyone.", default=None)
    
    args = parser.parse_args()
    reset_usage(args.username)
