from flask import Flask
from flask_cors import CORS
import os
from dotenv import load_dotenv
from pathlib import Path
from app.logger import get_logger

load_dotenv()
logger = get_logger()

def create_app():
    logger.info('=' * 60)
    logger.info('Flask application initialization started')
    logger.info('=' * 60)

    # Root directory path configuration
    root_path = Path(__file__).parent.parent
    template_folder = root_path / 'templates'
    static_folder = root_path / 'static'

    logger.debug(f'Root path: {root_path}')
    logger.debug(f'Template folder: {template_folder}')
    logger.debug(f'Static files folder: {static_folder}')

    app = Flask(__name__, template_folder=str(template_folder), static_folder=str(static_folder))
    logger.info('Flask app instance creation completed')

    CORS(app)
    logger.info('CORS enabled')

    app.config['GEMINI_API_KEY'] = os.getenv('GEMINI_API_KEY')
    app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB

    if app.config['GEMINI_API_KEY']:
        logger.info('Gemini API key loaded successfully')
    else:
        logger.warning('Gemini API key is not configured!')

    # Route registration
    from app import routes
    app.register_blueprint(routes.bp)
    logger.info('API routes registered successfully')

    logger.info('Flask application initialization completed')
    logger.info('=' * 60)

    return app
