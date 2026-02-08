#!/bin/bash

# Validation script to check if all required files are present

echo "Validating SpriteSync project structure..."
echo ""

ERRORS=0

# Check root files
echo "Checking root files..."
FILES=("README.md" "docker-compose.yml" ".gitignore")
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✓ $file"
    else
        echo "✗ $file - MISSING"
        ERRORS=$((ERRORS + 1))
    fi
done
echo ""

# Check services
echo "Checking services..."
SERVICES=("web-ui" "orchestrator" "diarization" "speaker-id" "stem-generator" "lipsync" "renderer" "mux")

for service in "${SERVICES[@]}"; do
    echo "Checking service: $service"
    
    if [ ! -d "services/$service" ]; then
        echo "  ✗ services/$service - DIRECTORY MISSING"
        ERRORS=$((ERRORS + 1))
        continue
    fi
    
    # Check Dockerfile
    if [ -f "services/$service/Dockerfile" ]; then
        echo "  ✓ Dockerfile"
    else
        echo "  ✗ Dockerfile - MISSING"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Check .dockerignore
    if [ -f "services/$service/.dockerignore" ]; then
        echo "  ✓ .dockerignore"
    else
        echo "  ✗ .dockerignore - MISSING"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Check application files based on service type
    if [ "$service" = "web-ui" ] || [ "$service" = "orchestrator" ] || [ "$service" = "renderer" ]; then
        # Node.js services
        if [ -f "services/$service/package.json" ]; then
            echo "  ✓ package.json"
        else
            echo "  ✗ package.json - MISSING"
            ERRORS=$((ERRORS + 1))
        fi
        
        if [ "$service" = "web-ui" ]; then
            if [ -f "services/$service/server.js" ]; then
                echo "  ✓ server.js"
            else
                echo "  ✗ server.js - MISSING"
                ERRORS=$((ERRORS + 1))
            fi
            
            if [ -f "services/$service/public/index.html" ]; then
                echo "  ✓ public/index.html"
            else
                echo "  ✗ public/index.html - MISSING"
                ERRORS=$((ERRORS + 1))
            fi
        else
            if [ -f "services/$service/index.js" ]; then
                echo "  ✓ index.js"
            else
                echo "  ✗ index.js - MISSING"
                ERRORS=$((ERRORS + 1))
            fi
        fi
    else
        # Python services
        if [ -f "services/$service/requirements.txt" ]; then
            echo "  ✓ requirements.txt"
        else
            echo "  ✗ requirements.txt - MISSING"
            ERRORS=$((ERRORS + 1))
        fi
        
        if [ -f "services/$service/app.py" ]; then
            echo "  ✓ app.py"
        else
            echo "  ✗ app.py - MISSING"
            ERRORS=$((ERRORS + 1))
        fi
    fi
    
    echo ""
done

# Summary
echo "================================"
if [ $ERRORS -eq 0 ]; then
    echo "✓ All validations passed!"
    echo "Project structure is complete."
    exit 0
else
    echo "✗ Found $ERRORS error(s)"
    echo "Please fix the missing files."
    exit 1
fi
