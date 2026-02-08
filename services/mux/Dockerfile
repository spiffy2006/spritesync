FROM python:3.11-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Create output directory
RUN mkdir -p /app/output

# Expose port
EXPOSE 5005

# Run with gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5005", "--workers", "2", "--timeout", "600", "app:app"]
