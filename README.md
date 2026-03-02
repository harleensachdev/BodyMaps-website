# Backend
---
### Create Conda Environment
```
conda create -n PanTS_backend python=3.11
conda activate PanTS_backend
```

### Set up environment backend
```
cd flask-server
touch .env // makes .env file
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

### Pull-based inference queue (VPN-safe)

Use this mode when GPU server is only reachable from VPN and cannot be SSH-ed from backend.

Server A (`flask-server/.env`):

```
WORKER_API_TOKEN=replace_with_strong_shared_token
INFERENCE_QUEUE_DIR=sessions/inference_queue
INFERENCE_LEASE_SECONDS=900
INFERENCE_MAX_ATTEMPTS=3
```

Worker (run on GPU host, e.g. bdmap1):

```
export WORKER_SERVER_BASE_URL="https://<server-a-host>"
export WORKER_API_TOKEN="replace_with_strong_shared_token"
export WORKER_ID="bdmap1-gpu0"

# Option A: script mode (args: input_path output_mask output_csv)
export WORKER_INFER_SCRIPT="/home/visitor/PanTS-Viewer/flask-server/scripts/run_epai_worker.sh"

# Option B: template mode (must create {output_mask})
# export WORKER_INFER_CMD_TEMPLATE='source /home/visitor/miniconda3/etc/profile.d/conda.sh && conda activate epai && nnUNetv2_predict_from_modelfolder -i {work_dir} -o {work_dir} -m <model_path> -f all'

python flask-server/scripts/epai_pull_worker.py
```

Queue endpoints on Server A:

- `POST /api/jobs` create job from `input_server_path`, `uploaded_filename`, or uploaded `MAIN_NIFTI`
- `GET /api/jobs/<job_id>` read status
- `GET /api/jobs/<job_id>/download` download `auto_masks.zip` when succeeded
- Worker-only: `GET /api/jobs/next`, `GET /api/jobs/<job_id>/input`, `POST /api/jobs/<job_id>/heartbeat`, `POST /api/jobs/<job_id>/result`, `POST /api/jobs/<job_id>/fail`

Quick smoke test from Server A:

```
cd flask-server
API_BASE=http://127.0.0.1:5001 \
INPUT_PATH=/real/path/to/ct.nii.gz \
./scripts/smoke_test_pull_queue.sh
```

This creates a queue job, polls `/api/jobs/<job_id>`, and downloads the zip once the worker completes it.

ePAI wrapper script notes:

- Script location: `flask-server/scripts/run_epai_worker.sh`
- Inputs: `<input_path> <output_mask_path> <output_csv_path>`
- Main envs on bdmap1: `EPAI_CONDA_ACTIVATE_PATH`, `EPAI_CONDA_ENV`, `EPAI_CKPT_PATH`, `EPAI_GPU`

Where to run what:

- Run `./scripts/smoke_test_pull_queue.sh` on **Server A** (or any host that can reach Server A API and has the input file path).
- Run `scripts/epai_pull_worker.py` on **bdmap1** (GPU host), ideally as a systemd service.

Systemd worker setup on bdmap1:

```
# 1) Copy templates to systemd and env locations
sudo cp deploy/systemd/epai-pull-worker.service /etc/systemd/system/
cp deploy/systemd/epai-pull-worker.env.example deploy/systemd/epai-pull-worker.env

# 2) Edit env file with real values
nano deploy/systemd/epai-pull-worker.env

# 3) Enable and start worker
sudo systemctl daemon-reload
sudo systemctl enable --now epai-pull-worker

# 4) Check logs
sudo systemctl status epai-pull-worker
journalctl -u epai-pull-worker -f
```

# Frontend
---
```
cd PanTS-Demo
touch .env
nano .env
```

Inside .env:
```
VITE_API_BASE=http://localhost:5001
```

### Run frontend
```
npm install
npm run dev
```
