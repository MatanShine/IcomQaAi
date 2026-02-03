# Nginx Setup for ai.zebracrm.com

This guide helps you configure nginx in the `icrm-prod` container to route `ai.zebracrm.com` requests to your FastAPI backend and frontend.

## Problem

Requests to `ai.zebracrm.com` are currently hitting the default nginx vhost and getting redirected to `icrmsw.zebracrm.com/crm.php?a=no_app` instead of being routed to your application.

## Solution Overview

1. Find the host gateway IP (needed to reach services on host ports from inside the container)
2. Create an nginx server block for `ai.zebracrm.com`
3. Route `/api/*` to FastAPI (host port 8080)
4. Route `/` to frontend (host port 84)
5. Reload nginx

## Quick Setup (Automated)

Run the setup script:

```bash
chmod +x nginx-setup-ai.zebracrm.com.sh
./nginx-setup-ai.zebracrm.com.sh
```

## Manual Setup

### Step 1: Find Host Gateway IP

```bash
docker exec -it icrm-prod sh -lc "ip route | awk '/default/ {print \$3}'"
```

This will output something like `172.17.0.1`. Save this as `HOSTGW`.

### Step 2: Test Connectivity

Verify you can reach your services from inside the container:

```bash
HOSTGW=$(docker exec -it icrm-prod sh -lc "ip route | awk '/default/ {print \$3}'" | tr -d '\r')
docker exec -it icrm-prod sh -lc "curl -i http://$HOSTGW:8080/api/v1/knowledge-base | head"
docker exec -it icrm-prod sh -lc "curl -i http://$HOSTGW:84/ | head"
```

Both should return HTTP responses (200, 404, etc.) - not connection errors.

### Step 3: Create Nginx Configuration

1. Edit the template file `nginx-ai.zebracrm.com.conf.template` and replace `HOSTGW` with your actual gateway IP.

2. Copy to the container:

```bash
docker cp nginx-ai.zebracrm.com.conf.template icrm-prod:/etc/nginx/sites-enabled/ai.zebracrm.com.conf
```

Or create it directly in the container:

```bash
docker exec -it icrm-prod sh -lc "cat > /etc/nginx/sites-enabled/ai.zebracrm.com.conf" < nginx-ai.zebracrm.com.conf.template
```

(Remember to replace `HOSTGW` first!)

### Step 4: Test and Reload Nginx

```bash
# Test configuration
docker exec -it icrm-prod sh -lc "nginx -t"

# If test passes, reload
docker exec -it icrm-prod sh -lc "nginx -s reload"
```

### Step 5: Verify

Test from the host:

```bash
# Test HTTP
curl -i http://127.0.0.1/api/v1/knowledge-base -H 'Host: ai.zebracrm.com'

# Test through Cloudflare (if DNS is configured)
curl -i https://ai.zebracrm.com/api/v1/knowledge-base
```

Expected: HTTP 200 (or 404/405 if endpoint doesn't exist) - **not** 302 redirect.

## HTTPS Configuration

If Cloudflare is using "Full" mode (HTTPS to origin), you'll also need a `listen 443 ssl;` server block.

### Find Existing SSL Configuration

```bash
docker exec -it icrm-prod sh -lc "nginx -T 2>/dev/null | grep -n 'listen 443'"
```

### Add ai.zebracrm.com to SSL Server Block

You can either:
1. Add `server_name ai.zebracrm.com;` to an existing SSL server block, OR
2. Create a new SSL server block specifically for `ai.zebracrm.com`

If creating a new one, you'll need SSL certificates. For Cloudflare, you can use:
- Cloudflare Origin Certificate (recommended)
- Or self-signed (Cloudflare will handle SSL termination)

## Troubleshooting

### Still Getting 302 Redirect

1. Check that the configuration file was created:
   ```bash
   docker exec -it icrm-prod sh -lc "ls -la /etc/nginx/sites-enabled/ai.zebracrm.com.conf"
   ```

2. Verify nginx is using the new config:
   ```bash
   docker exec -it icrm-prod sh -lc "nginx -T 2>/dev/null | grep -A 20 'server_name ai.zebracrm.com'"
   ```

3. Check if there's a conflicting `server_name _;` block that's catching requests first. Nginx uses the first matching server block.

### Connection Refused to Backend

- Verify `HOSTGW` is correct
- Check that services are running on host ports 8080 and 84
- Test connectivity from inside the container as shown in Step 2

### HTTPS Not Working

- Ensure you have an SSL server block for `ai.zebracrm.com`
- Check Cloudflare SSL/TLS mode (should be "Full" or "Full (strict)")
- Verify SSL certificates are valid

## Architecture

```
Cloudflare (HTTPS)
    ↓
icrm-prod:80/443 (nginx)
    ├─ /api/* → HOSTGW:8080 (FastAPI)
    └─ / → HOSTGW:84 (Frontend)
```

Where `HOSTGW` is the Docker bridge gateway IP (typically `172.17.0.1`).

