import { IconArrowBackUp, IconArrowForwardUp, IconBrush, IconCloudUpload, IconDownload, IconEraser, IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { API_BASE } from "../../helpers/constants";
import {
	colorForNewClass,
	getCustomSegmentLabelsForExport,
	getMaskEditHistoryState,
	getSegmentationExport,
	redoMaskEdit,
	setActiveEditSegment,
	setMaskBrushSize,
	subscribeToSegmentationEdits,
	undoMaskEdit,
} from "../../helpers/CornerstoneNifti2";
import { buildNiftiGzBlob } from "../../helpers/niftiWriter";
import { downloadBlob } from "../../helpers/readingSession";
import type { CheckBoxData } from "../../types";
import "./MaskEditPanel.css";
import JSZip from "jszip";

export type MaskEditMode = "brush" | "eraser" | null;

type Props = {
	organs: CheckBoxData[];
	caseId: string;
	/** Dataset case id — enables "Save to server" (versioned under edited_masks/). */
	serverCaseId?: string;
	mode: MaskEditMode;
	onModeChange: (mode: MaskEditMode) => void;
	onClose: () => void;
	/** Reading-session hook — fires once per edit burst with a description. */
	onEdit?: (detail: string) => void;
	/** Create a new label class (name + hex colour) and return it for the organ list. */
	onCreateClass?: (name: string, colorHex: string) => CheckBoxData | null;
};

const DEFAULT_BRUSH_MM = 10;

function colorToHex([r, g, b]: readonly number[]): string {
	const h = (n: number) => n.toString(16).padStart(2, "0");
	return `#${h(r)}${h(g)}${h(b)}`;
}

// Right-side panel for correcting the segmentation masks: pick the target organ,
// paint or erase on any 2D pane, undo/redo, and download the edited labelmap as
// .nii.gz. Everything happens client-side on the loaded labelmap volume.
function MaskEditPanel({ organs, caseId, serverCaseId, mode, onModeChange, onClose, onEdit, onCreateClass }: Props) {
	const [segment, setSegment] = useState(organs[0]?.id ?? 1);
	const [brushMm, setBrushMm] = useState(DEFAULT_BRUSH_MM);
	const [edited, setEdited] = useState(false);
	const [history, setHistory] = useState({ canUndo: false, canRedo: false });
	const [exporting, setExporting] = useState(false);
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const [showNewClass, setShowNewClass] = useState(false);
	const [newClassName, setNewClassName] = useState("");
	const [newClassColor, setNewClassColor] = useState(() =>
		colorToHex(colorForNewClass((organs.length || 0) + 1))
	);
	const [createError, setCreateError] = useState("");

	// Seed the brush target/size when the panel opens.
	useEffect(() => {
		setActiveEditSegment(segment);
		setMaskBrushSize(brushMm);
		// mount-only seeding; the change handlers below keep them current
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (organs.some((o) => o.id === segment)) return;
		const fallback = organs[0]?.id ?? 1;
		setSegment(fallback);
		setActiveEditSegment(fallback);
	}, [organs, segment]);

	const createClass = () => {
		setCreateError("");
		const trimmed = newClassName.trim();
		if (!trimmed) {
			setCreateError("Enter a name for the new class.");
			return;
		}
		if (!onCreateClass) return;
		const created = onCreateClass(trimmed, newClassColor);
		if (!created) {
			setCreateError("Could not create class — is a segmentation loaded?");
			return;
		}
		setSegment(created.id);
		setActiveEditSegment(created.id);
		setNewClassName("");
		setNewClassColor(colorToHex(colorForNewClass(created.id + 1)));
		setShowNewClass(false);
		onModeChange("brush");
		onEdit?.(`Created new class "${created.label}"`);
	};

	useEffect(() => {
		const organLabel = organs.find((o) => o.id === segment)?.label ?? `segment ${segment}`;
		const unsubscribe = subscribeToSegmentationEdits(() => {
			setEdited(true);
			setHistory(getMaskEditHistoryState());
			onEdit?.(`Edited ${organLabel} mask`);
		});
		return unsubscribe;
	}, [segment, organs, onEdit]);

	// Versioned save into {PANTS_PATH}/edited_masks/<case>/ — never overwrites the
	// dataset's original labels.
	const saveToServer = async () => {
		if (!serverCaseId) return;
		const labelmap = getSegmentationExport();
		if (!labelmap) return;
		setSaveState("saving");
		try {
			const form = new FormData();
			form.append("mask", buildNiftiGzBlob(labelmap), "combined_labels_edited.nii.gz");
			
			const customLabels = getCustomSegmentLabelsForExport();
			if (Object.keys(customLabels).length > 0) {
				form.append(
					"labels",
					new Blob([JSON.stringify(customLabels)], { type: "application/json" }),
					"labels.json"
				);
			}

			const res = await fetch(`${API_BASE}/api/save-edited-mask/${serverCaseId}`, {
				method: "POST",
				body: form,
			});

			const body = await res.json().catch(() => ({}));
			if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
			setSaveState("saved");
			window.setTimeout(() => setSaveState("idle"), 2500);
		} catch (e) {
			console.error(e);
			setSaveState("error");
			window.setTimeout(() => setSaveState("idle"), 4000);
		}
	};

	const download = () => {
		const labelmap = getSegmentationExport();
		if (!labelmap) return;
		setExporting(true);
		try {
			// Gzipping a full labelmap blocks for a moment; a rAF lets the button
			// repaint to its busy state first.
			requestAnimationFrame(() => {
				void (async () => {
					try {
						const customLabels = getCustomSegmentLabelsForExport();
						const hasCustomClasses = Object.keys(customLabels).length > 0;

						if (!hasCustomClasses){
							downloadBlob(buildNiftiGzBlob(labelmap), `case${caseId}_edited_labels.nii.gz`);
						}
						else{
							// Custom classes exist
							// Join mask and labels.json sidecar into a .zip to prevent name/color metadata from being lost

							const zip = new JSZip();
							zip.file("combined_labels_edited.nii.gz", buildNiftiGzBlob(labelmap));
							zip.file("labels.json", JSON.stringify(customLabels, null, 2));
							const blob = await zip.generateAsync({ type: "blob" });
							downloadBlob(blob, `case${caseId}_edited_labels.zip`);
						}
					} finally {
						setExporting(false);
					}
				})();
			});
		} catch {
			setExporting(false);
		}
	};

	return (
		<div className="vp-edit" role="region" aria-label="Edit masks">
			<div className="vp-edit__head">
				<span className="vp-panel__title">Edit Masks</span>
				<button className="vp-edit__close" onClick={onClose} aria-label="Close mask editing">
					×
				</button>
			</div>
			<div className="vp-edit__body">
				<label className="vp-edit__field">
					<span className="vp-edit__label">Target organ</span>
					<select
						className="vp-edit__select"
						value={segment}
						onChange={(e) => {
							const id = Number(e.target.value);
							setSegment(id);
							setActiveEditSegment(id);
						}}
					>
						{organs.map((o) => (
							<option key={o.id} value={o.id}>
								{o.label}
							</option>
						))}
					</select>
				</label>

				{onCreateClass && (
					<div className="vp-edit__new-class">
						<button
							type="button"
							className={`vp-edit__new-toggle ${showNewClass ? "is-open" : ""}`}
							onClick={() => setShowNewClass((v) => !v)}
						>
							<IconPlus size={15} />
							{showNewClass ? "Cancel new class" : "New class…"}
						</button>
						{showNewClass && (
							<div className="vp-edit__new-form">
								<label className="vp-edit__field">
									<span className="vp-edit__label">Class name</span>
									<input
										type="text"
										className="vp-edit__input"
										placeholder="e.g. lesion, stent"
										value={newClassName}
										onChange={(e) => setNewClassName(e.target.value)}
										onKeyDown={(e) => { if (e.key === "Enter") createClass(); }}
									/>
								</label>
								<label className="vp-edit__field">
									<span className="vp-edit__label">Colour</span>
									<div className="vp-edit__color-row">
										<input
											type="color"
											className="vp-edit__color"
											value={newClassColor}
											onChange={(e) => setNewClassColor(e.target.value)}
											aria-label="New class colour"
										/>
										<span className="vp-edit__color-swatch" style={{ background: newClassColor }} />
									</div>
								</label>
								{createError && <div className="vp-edit__error">{createError}</div>}
								<button type="button" className="vp-edit__create" onClick={createClass}>
									<IconBrush size={15} /> Create &amp; paint
								</button>
							</div>
						)}
					</div>
				)}

				<div className="vp-edit__modes">
					<button
						className={`vp-edit__mode ${mode === "brush" ? "is-active" : ""}`}
						onClick={() => onModeChange(mode === "brush" ? null : "brush")}
					>
						<IconBrush size={16} /> Paint
					</button>
					<button
						className={`vp-edit__mode ${mode === "eraser" ? "is-active" : ""}`}
						onClick={() => onModeChange(mode === "eraser" ? null : "eraser")}
					>
						<IconEraser size={16} /> Erase
					</button>
				</div>

				<label className="vp-edit__field">
					<span className="vp-edit__label">
						Brush size <span className="vp-edit__val">{brushMm} mm</span>
					</span>
					<input
						type="range"
						min="2"
						max="40"
						step="1"
						className="vp-range"
						aria-label="Brush size"
						value={brushMm}
						onChange={(e) => {
							const mm = Number(e.target.value);
							setBrushMm(mm);
							setMaskBrushSize(mm);
						}}
					/>
				</label>

				<div className="vp-edit__history">
					<button
						className="vp-edit__btn"
						disabled={!history.canUndo}
						onClick={() => {
							undoMaskEdit();
							setHistory(getMaskEditHistoryState());
						}}
					>
						<IconArrowBackUp size={15} /> Undo
					</button>
					<button
						className="vp-edit__btn"
						disabled={!history.canRedo}
						onClick={() => {
							redoMaskEdit();
							setHistory(getMaskEditHistoryState());
						}}
					>
						<IconArrowForwardUp size={15} /> Redo
					</button>
				</div>

				<button className="vp-edit__download" disabled={!edited || exporting} onClick={download}>
					<IconDownload size={16} />
					{exporting ? "Packing…" : "Download edited mask (.nii.gz)"}
				</button>
				{serverCaseId && (
					<button
						className={`vp-edit__save ${saveState === "error" ? "is-error" : ""}`}
						disabled={!edited || saveState === "saving"}
						onClick={() => { void saveToServer(); }}
					>
						<IconCloudUpload size={16} />
						{saveState === "saving"
							? "Saving…"
							: saveState === "saved"
								? "Saved ✓"
								: saveState === "error"
									? "Save failed — retry"
									: "Save to server (new version)"}
					</button>
				)}
				<div className="vp-edit__hint">
					{mode
						? `${mode === "brush" ? "Painting" : "Erasing"} on the 2D panes — drag to ${mode === "brush" ? "fill" : "clear"}.`
						: "Pick Paint or Erase, then drag on any 2D pane."}
					{" "}Edits stay in your browser until downloaded.
				</div>
			</div>
		</div>
	);
}

export default MaskEditPanel;
