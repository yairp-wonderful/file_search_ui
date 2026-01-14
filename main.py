from app import create_app
import os

if __name__ == '__main__':
    app = create_app()
    # Use env var or default to set debug mode
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    app.run(debug=debug_mode, host='0.0.0.0', port=5001)
