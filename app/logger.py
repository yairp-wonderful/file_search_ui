import logging
import logging.handlers
from pathlib import Path
import os

# Create logs directory
log_dir = Path(__file__).parent.parent / 'logs'
log_dir.mkdir(exist_ok=True)

# Logger setup
logger = logging.getLogger('gemini_app')

# Clear existing handlers to avoid duplicates
if logger.hasHandlers():
    logger.handlers.clear()

logger.setLevel(logging.DEBUG)
logger.propagate = False  # Do not propagate to parent logger

# File handler (rotating)
log_file = log_dir / 'app.log'
file_handler = logging.handlers.RotatingFileHandler(
    log_file,
    maxBytes=10 * 1024 * 1024,  # 10MB
    backupCount=5
)
file_handler.setLevel(logging.DEBUG)

# Console handler
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)

# Formatter
formatter = logging.Formatter(
    '%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
file_handler.setFormatter(formatter)
console_handler.setFormatter(formatter)

# Attach handlers
logger.addHandler(file_handler)
logger.addHandler(console_handler)

def get_logger():
    return logger
