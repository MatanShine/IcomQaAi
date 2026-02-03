#!/bin/bash
# Script to configure nginx in icrm-prod for ai.zebracrm.com
# This routes /api/* to FastAPI (host:8080) and / to frontend (host:84)

set -e

CONTAINER="icrm-prod"
NGINX_CONFIG="/etc/nginx/sites-enabled/ai.zebracrm.com.conf"

echo "Step 1: Finding host gateway IP..."
HOSTGW=$(docker exec -it $CONTAINER sh -lc "ip route | awk '/default/ {print \$3}'" | tr -d '\r\n')
echo "Host gateway IP: $HOSTGW"

if [ -z "$HOSTGW" ]; then
    echo "ERROR: Could not determine host gateway IP"
    exit 1
fi

echo ""
echo "Step 2: Testing connectivity to services..."
echo "Testing FastAPI on $HOSTGW:8080..."
if docker exec -it $CONTAINER sh -lc "curl -s -o /dev/null -w '%{http_code}' http://$HOSTGW:8080/api/v1/knowledge-base" | grep -q "200\|404\|405"; then
    echo "✓ FastAPI is reachable"
else
    echo "⚠ Warning: FastAPI may not be reachable (this is OK if service is down)"
fi

echo "Testing frontend on $HOSTGW:84..."
if docker exec -it $CONTAINER sh -lc "curl -s -o /dev/null -w '%{http_code}' http://$HOSTGW:84/" | grep -q "200\|404"; then
    echo "✓ Frontend is reachable"
else
    echo "⚠ Warning: Frontend may not be reachable (this is OK if service is down)"
fi

echo ""
echo "Step 3: Creating nginx configuration..."
cat > /tmp/ai.zebracrm.com.conf <<EOF
# Nginx configuration for ai.zebracrm.com
# Routes /api/* to FastAPI (host:8080) and / to frontend (host:84)

server {
    listen 80;
    server_name ai.zebracrm.com;

    # API -> FastAPI (host port 8080)
    location /api/ {
        proxy_pass http://$HOSTGW:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host \$host;
        
        # CORS headers (if needed)
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization' always;
        
        # Handle preflight requests
        if (\$request_method = 'OPTIONS') {
            add_header 'Access-Control-Allow-Origin' '*';
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS';
            add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization';
            add_header 'Access-Control-Max-Age' 1728000;
            add_header 'Content-Type' 'text/plain; charset=utf-8';
            add_header 'Content-Length' 0;
            return 204;
        }
    }

    # Frontend -> Vite preview (host port 84)
    location / {
        proxy_pass http://$HOSTGW:84;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host \$host;
        
        # WebSocket support (if needed for Vite HMR)
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

echo "Configuration created. Copying to container..."
docker cp /tmp/ai.zebracrm.com.conf $CONTAINER:$NGINX_CONFIG

echo ""
echo "Step 4: Testing nginx configuration..."
if docker exec -it $CONTAINER sh -lc "nginx -t"; then
    echo "✓ Nginx configuration is valid"
else
    echo "✗ Nginx configuration test failed!"
    exit 1
fi

echo ""
echo "Step 5: Reloading nginx..."
docker exec -it $CONTAINER sh -lc "nginx -s reload"
echo "✓ Nginx reloaded"

echo ""
echo "Step 6: Testing the new configuration..."
echo "Testing HTTP endpoint..."
HTTP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: ai.zebracrm.com' http://127.0.0.1/api/v1/knowledge-base)
echo "HTTP Status: $HTTP_STATUS"

if [ "$HTTP_STATUS" = "302" ]; then
    echo "⚠ Still getting 302 redirect. You may need to check HTTPS configuration."
elif [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "404" ] || [ "$HTTP_STATUS" = "405" ]; then
    echo "✓ Success! API is now reachable (status: $HTTP_STATUS)"
else
    echo "⚠ Unexpected status: $HTTP_STATUS"
fi

echo ""
echo "Done! Configuration file is at: $NGINX_CONFIG"
echo ""
echo "Next steps:"
echo "1. If you're using HTTPS, you'll need to add a 'listen 443 ssl;' server block"
echo "2. Test with: curl -i http://127.0.0.1/api/v1/knowledge-base -H 'Host: ai.zebracrm.com'"
echo "3. Test with: curl -i https://ai.zebracrm.com/api/v1/knowledge-base"

