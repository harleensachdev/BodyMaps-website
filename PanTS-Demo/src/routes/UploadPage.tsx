import React, { useRef, useState } from 'react';
import './UploadPage.css';
import {
  IconPlus,
  IconArrowUp,
  // IconDownload
} from "@tabler/icons-react";
import { API_BASE } from '../helpers/constants';

interface UploadPageProps {}

const UploadPage: React.FC<UploadPageProps> = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [, setMessage] = useState<string>("");
  // const [, setInferenceStarted] = useState(false);
  // const [, setZipFilename] = useState<string | null>(null);

  const allowedExtensions = [".nii", ".nii.gz"];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const filteredFiles = Array.from(e.target.files).filter(file =>
      allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    );

    if (filteredFiles.length === 0) {
      alert("Please select .nii or .nii.gz files only");
      return;
    }

    setSelectedFiles(prev => [...prev, ...filteredFiles]);
  };

  const handlePlusClick = () => {
    fileInputRef.current?.click();
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Step 0: Upload files to server
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB per chunk

  const handleUploadClick = async () => {
    if (selectedFiles.length === 0) return alert("No files selected!");

    const file = selectedFiles[0];
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const sessionId = crypto.randomUUID(); // generate unique session ID

    setMessage(`Uploading ${file.name} in ${totalChunks} chunks...`);

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const formData = new FormData();
        formData.append("session_id", sessionId);
        formData.append("chunk_index", i.toString());
        formData.append("total_chunks", totalChunks.toString());
        formData.append("file", chunk);

        const res = await fetch(`${API_BASE}/api/upload-inference-chunk`, {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Chunk upload failed");
      }

      setMessage("All chunks uploaded, combining...");

      // Combine chunks on the backend
      const finalizeRes = await fetch(`${API_BASE}/api/finalize-upload`, {
        method: "POST",
        body: new URLSearchParams({
          session_id: sessionId,
          total_chunks: totalChunks.toString(),
          output_filename: file.name,
        }),
      });

      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) throw new Error(finalizeData.error);

      setMessage(`Upload complete! File ready at ${finalizeData.path}`);
    } catch (err) {
      console.error(err);
      setMessage("Upload failed: " + (err as Error).message);
    }
  };

  // // Step 1: Run inference
  // const handleRunInference = async () => {
  //   setMessage("Running inference...");
  //   try {
  //     const res = await fetch("/run-inference", { method: "POST" });
  //     const data = await res.json();
  //     if (res.ok) {
  //       setMessage(data.status || "Inference started");
  //       setInferenceStarted(true);
  //       setZipFilename(null);
  //     } else {
  //       setMessage(data.error || "Inference failed");
  //     }
  //   } catch (err) {
  //     console.error(err);
  //     setMessage("Inference failed: network error");
  //   }
  // };

  // // Step 2: Prepare zip download
  // const handlePrepareDownload = async () => {
  //   if (!inferenceStarted) {
  //     setMessage("Run inference first");
  //     return;
  //   }

  //   setMessage("Preparing output zip...");
  //   try {
  //     const res = await fetch("/prepare-download", { method: "POST" });
  //     const data = await res.json();

  //     if (res.ok && data.filename) {
  //       setZipFilename(data.filename);
  //       setMessage(`Output prepared: ${data.filename}. Ready to download.`);
  //     } else {
  //       setMessage("Failed to prepare output zip");
  //       console.error(data);
  //     }
  //   } catch (err) {
  //     console.error(err);
  //     setMessage("Error preparing download");
  //   }
  // };

  // // Step 3: Download zip
  // const handleDownload = async () => {
  //   if (!zipFilename) {
  //     setMessage("No prepared file available. Prepare download first.");
  //     return;
  //   }

  //   try {
  //     const res = await fetch(`/download-prepared-output?filename=${zipFilename}`);
  //     const data = await res.json();

  //     if (res.ok && data.url) {
  //       const link = document.createElement("a");
  //       link.href = data.url;
  //       link.download = data.filename || zipFilename;
  //       document.body.appendChild(link);
  //       link.click();
  //       document.body.removeChild(link);
  //       setMessage(`Download started: ${data.filename || zipFilename}`);
  //     } else {
  //       setMessage("Download failed");
  //       console.error(data);
  //     }
  //   } catch (err) {
  //     console.error(err);
  //     setMessage("Download failed");
  //   }
  // };

  return (
    <div className="upload-page">

      {/* Selected files */}
      <div className="file-tags">
        {selectedFiles.map((file, index) => (
          <div key={index} className="file-tag">
            {file.name}
            <span className="remove-tag" onClick={() => removeFile(index)}>×</span>
          </div>
        ))}
      </div>

      {/* Upload / input bar */}
      <div className="upload-bar">
        <button className="plus-button" onClick={handlePlusClick}>
          <IconPlus />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="*/*"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        <input
          type="text"
          readOnly
          placeholder="Click + to select .nii or .nii.gz files"
          className="upload-input"
          onClick={handlePlusClick}
          value={selectedFiles.map(f => f.name).join(', ')}
        />

        <button className="upload-button" onClick={handleUploadClick}>
          <IconArrowUp />
        </button>
      </div>
    </div>
  );
};

export default UploadPage;
