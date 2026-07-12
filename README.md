# Backend

#### Create Conda Environment
```
conda create -n PanTS_backend python=3.11
conda activate PanTS_backend
```

#### Set up environment backend
```
cd flask-server
touch .env  # creates the .env file
nano .env
```

Inside .env file:
```
BASE_PATH=/

PANTS_PATH=/folder/where/PanTS

USE_SSL=false
```

Run backend:

```
pip install -r requirements.txt
python app.py
```

# Frontend

```
cd PanTS-Demo
touch .env
nano .env
```

Inside .env:
```
VITE_API_BASE=http://localhost:5001
```

#### Run frontend

```
npm install
npm run dev
```

# Deploying Updates to the Server
---

After pushing changes, SSH into the server and run the following.

```
ssh visitor@bdmap1.wse.jhu.edu
```

#### 1. Pull latest changes
Production must always deploy from `main`. Confirm the branch first, then pull.
```
cd /home/visitor/PanTS-Viewer
git fetch
git checkout main
git pull
```
If `git pull` (or the checkout) refuses because of "local changes would be overwritten," someone edited files directly on the server. Do **not** force past it. Run `git status` to see what changed, then discard each file with `git checkout -- <file>` (or ask the maintainer) before pulling again. The server should never carry local edits.

#### 2. Rebuild the frontend and refresh backend dependencies
```
cd /home/visitor/PanTS-Viewer/PanTS-Demo && npm ci && npm run build
/home/visitor/.conda/envs/PanTS_backend/bin/pip install -r /home/visitor/PanTS-Viewer/flask-server/requirements.txt
```
The `pip install` is a fast no-op when nothing changed, but it is required whenever a PR adds or bumps a Python dependency — otherwise the restarted backend crashes on a missing import and the site goes empty. If `npm run build` errors out, **stop here**: nginx keeps serving the old site until a build succeeds, so fix the error before restarting the backend.

#### 3. Restart the backend
```
# Stop the old gunicorn process and wait for the port to free
pkill -f "gunicorn.*app:app"; sleep 2
pgrep -f "gunicorn.*app:app" && echo "still running - rerun the line above" || echo "port clear"

# Start a new gunicorn process
nohup /home/visitor/.conda/envs/PanTS_backend/bin/gunicorn \
  --worker-class gthread --workers 1 --threads 8 \
  --bind 127.0.0.1:8000 --timeout 3600 \
  --chdir /home/visitor/PanTS-Viewer/flask-server \
  app:app > /tmp/gunicorn.log 2>&1 &
echo "PID: $!"
```

#### 4. Verify the backend is running
Give it a few seconds to load, then check the backend booted, the dataset loads, and masks serve (all three must succeed).
```
sleep 8
curl http://127.0.0.1:8000/api/ping
curl -s "http://127.0.0.1:8000/api/search?limit=1" | head -c 120; echo
curl -s -o /dev/null -w "segmentations: %{http_code}\n" "http://127.0.0.1:8000/api/get-segmentations/17.nii.gz"
```
Expect `{"message":"pong"}`, a JSON object with `items`, and `segmentations: 200`. If the backend fails to boot, check the log for the traceback.

Logs are written to `/tmp/gunicorn.log`.
