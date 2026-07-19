"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Check,
  Trash2,
  MousePointer2,
  PenLine,
  Undo2,
  Plus,
  Minus,
  Maximize2,
} from "lucide-react";
import {
  PLOT_STATUS_STYLES,
  NON_PLOT_STYLE,
  SHAPE_KIND_LABELS,
  polygonCentroid,
  toSvgPoints,
  clamp01,
  type Point,
  type LayoutShapeKind,
  type PlotStatus,
} from "@/lib/layout";

interface PlotOption {
  id: string;
  plotNumber: string;
  status: PlotStatus;
}

/** A shape as the editor holds it. `id` is absent until the server assigns one. */
interface DraftShape {
  /** Stable client key. Survives save so React does not remount the list. */
  key: string;
  id?: string;
  plotId: string | null;
  kind: LayoutShapeKind;
  label: string;
  points: Point[];
}

interface Props {
  layoutId: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  plots: PlotOption[];
  initialShapes: {
    id: string;
    plotId: string | null;
    kind: LayoutShapeKind;
    label: string | null;
    points: Point[];
  }[];
  canEdit: boolean;
}

type Mode = "select" | "draw";

const MIN_SCALE = 1;
const MAX_SCALE = 10;

let keyCounter = 0;
const nextKey = () => `shape-${(keyCounter += 1)}-${Date.now()}`;

export default function LayoutEditor({
  layoutId,
  imageUrl,
  imageWidth,
  imageHeight,
  plots,
  initialShapes,
  canEdit,
}: Props) {
  const router = useRouter();

  const [shapes, setShapes] = useState<DraftShape[]>(() =>
    initialShapes.map((shape) => ({
      key: nextKey(),
      id: shape.id,
      plotId: shape.plotId,
      kind: shape.kind,
      label: shape.label ?? "",
      points: shape.points,
    }))
  );
  const [mode, setMode] = useState<Mode>("select");
  const [draft, setDraft] = useState<Point[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingVertex = useRef<{ key: string; index: number } | null>(null);
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null
  );

  const selected = shapes.find((shape) => shape.key === selectedKey) ?? null;

  /** Plots already drawn — a plot may appear once per plan. */
  const takenPlotIds = useMemo(
    () =>
      new Set(
        shapes
          .filter((shape) => shape.key !== selectedKey && shape.plotId)
          .map((shape) => shape.plotId as string)
      ),
    [shapes, selectedKey]
  );

  const markDirty = useCallback(() => {
    setDirty(true);
    setSaved(false);
  }, []);

  /**
   * Screen coordinates → normalised 0..1 image space.
   *
   * Uses the SVG's own CTM rather than the bounding rect, so it stays correct
   * under the zoom transform, under `preserveAspectRatio` letterboxing, and at
   * any container size. Doing this with getBoundingClientRect arithmetic is
   * where hand-rolled editors usually drift a few pixels at high zoom.
   */
  const toNormalised = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const svg = svgRef.current;
      if (!svg) return null;

      const matrix = svg.getScreenCTM();
      if (!matrix) return null;

      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const local = point.matrixTransform(matrix.inverse());

      return {
        x: clamp01(local.x / imageWidth),
        y: clamp01(local.y / imageHeight),
      };
    },
    [imageWidth, imageHeight]
  );

  const commitDraft = useCallback(() => {
    if (draft.length < 3) {
      setDraft([]);
      return;
    }
    const key = nextKey();
    setShapes((prev) => [
      ...prev,
      { key, plotId: null, kind: "PLOT", label: "", points: draft },
    ]);
    setDraft([]);
    setSelectedKey(key);
    markDirty();
  }, [draft, markDirty]);

  // --- Keyboard ------------------------------------------------------------
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // Never steal keys from a field the user is typing in.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      if (event.key === "Escape") {
        if (draft.length > 0) setDraft([]);
        else setSelectedKey(null);
      }
      if (event.key === "Enter" && draft.length >= 3) {
        event.preventDefault();
        commitDraft();
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        draft.length > 0
      ) {
        event.preventDefault();
        setDraft((prev) => prev.slice(0, -1));
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        draft.length === 0 &&
        selectedKey
      ) {
        event.preventDefault();
        setShapes((prev) => prev.filter((shape) => shape.key !== selectedKey));
        setSelectedKey(null);
        markDirty();
      }
      if (event.key === "d" || event.key === "D") setMode("draw");
      if (event.key === "v" || event.key === "V") setMode("select");
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, selectedKey, commitDraft, markDirty]);

  /** Warns before a tab close that would lose unsaved boundaries. */
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // --- Canvas interaction ---------------------------------------------------
  function handleCanvasPointerDown(event: React.PointerEvent) {
    if (mode === "draw" && canEdit) return; // handled on click
    if (event.button !== 0 && event.button !== 1) return;

    panning.current = {
      x: event.clientX,
      y: event.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  }

  function handleCanvasPointerMove(event: React.PointerEvent) {
    // Vertex drag wins over pan.
    if (draggingVertex.current && canEdit) {
      const point = toNormalised(event.clientX, event.clientY);
      if (!point) return;
      const { key, index } = draggingVertex.current;
      setShapes((prev) =>
        prev.map((shape) =>
          shape.key === key
            ? {
                ...shape,
                points: shape.points.map((existing, i) =>
                  i === index ? point : existing
                ),
              }
            : shape
        )
      );
      return;
    }

    if (panning.current) {
      const start = panning.current;
      setOffset({
        x: start.ox + (event.clientX - start.x),
        y: start.oy + (event.clientY - start.y),
      });
    }
  }

  function handleCanvasPointerUp() {
    if (draggingVertex.current) {
      draggingVertex.current = null;
      markDirty();
    }
    panning.current = null;
  }

  function handleCanvasClick(event: React.MouseEvent) {
    if (mode !== "draw" || !canEdit) return;
    const point = toNormalised(event.clientX, event.clientY);
    if (!point) return;

    // Clicking the first vertex closes the polygon — the convention every
    // mapping tool uses, so nobody has to be told.
    if (draft.length >= 3) {
      const first = draft[0];
      const dx = (point.x - first.x) * imageWidth;
      const dy = (point.y - first.y) * imageHeight;
      if (Math.hypot(dx, dy) < 12 / scale) {
        commitDraft();
        return;
      }
    }

    setDraft((prev) => [...prev, point]);
  }

  function zoom(factor: number) {
    setScale((current) =>
      Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * factor))
    );
  }

  function resetView() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  function updateSelected(patch: Partial<DraftShape>) {
    if (!selectedKey) return;
    setShapes((prev) =>
      prev.map((shape) =>
        shape.key === selectedKey ? { ...shape, ...patch } : shape
      )
    );
    markDirty();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/layouts/${layoutId}/shapes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shapes: shapes.map((shape) => ({
            id: shape.id,
            plotId: shape.plotId,
            kind: shape.kind,
            label: shape.label,
            points: shape.points,
          })),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save the boundaries.");
        setSaving(false);
        return;
      }

      // Re-key from the server response so newly created shapes pick up their
      // real ids — otherwise the next save recreates them and the row ids
      // churn on every click of Save.
      const returned = (data.shapes ?? []) as {
        id: string;
        plotId: string | null;
        kind: LayoutShapeKind;
        label: string | null;
        points: Point[];
      }[];

      setShapes(
        returned.map((shape) => ({
          key: nextKey(),
          id: shape.id,
          plotId: shape.plotId,
          kind: shape.kind,
          label: shape.label ?? "",
          points: shape.points,
        }))
      );

      setSelectedKey(null);
      setDirty(false);
      setSaved(true);
      setSaving(false);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  function fillFor(shape: DraftShape) {
    if (shape.kind !== "PLOT") return NON_PLOT_STYLE.fill;
    const plot = plots.find((option) => option.id === shape.plotId);
    if (!plot) return "rgba(58, 58, 54, 0.18)";
    return PLOT_STATUS_STYLES[plot.status].fill;
  }

  function strokeFor(shape: DraftShape) {
    if (shape.kind !== "PLOT") return NON_PLOT_STYLE.stroke;
    const plot = plots.find((option) => option.id === shape.plotId);
    // Unbound plot shapes are drawn in the warning colour: a boundary with no
    // plot behind it renders as a dead area on the public plan, and it should
    // be obvious before publishing, not after.
    if (!plot) return "#B98C1E";
    return PLOT_STATUS_STYLES[plot.status].stroke;
  }

  const unbound = shapes.filter(
    (shape) => shape.kind === "PLOT" && !shape.plotId
  ).length;

  return (
    <div className="mt-10 grid grid-cols-1 gap-10 xl:grid-cols-12">
      {/* ---------------- Canvas ---------------- */}
      <div className="xl:col-span-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex border border-charcoal/20">
            <button
              type="button"
              onClick={() => {
                setMode("select");
                setDraft([]);
              }}
              className={`flex items-center gap-2 px-4 py-2.5 text-[11px] uppercase tracking-[0.2em] transition-colors duration-300 ${
                mode === "select"
                  ? "bg-charcoal text-cream"
                  : "text-muted hover:text-charcoal"
              }`}
            >
              <MousePointer2 size={13} strokeWidth={1.5} />
              Select
            </button>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                setMode("draw");
                setSelectedKey(null);
              }}
              className={`flex items-center gap-2 border-l border-charcoal/20 px-4 py-2.5 text-[11px] uppercase tracking-[0.2em] transition-colors duration-300 disabled:opacity-40 ${
                mode === "draw"
                  ? "bg-charcoal text-cream"
                  : "text-muted hover:text-charcoal"
              }`}
            >
              <PenLine size={13} strokeWidth={1.5} />
              Draw
            </button>
          </div>

          {draft.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setDraft((prev) => prev.slice(0, -1))}
                className="btn-admin-ghost"
              >
                <Undo2 size={13} strokeWidth={1.5} />
                Undo point
              </button>
              <button
                type="button"
                onClick={commitDraft}
                disabled={draft.length < 3}
                className="btn-admin"
              >
                Finish shape ({draft.length})
              </button>
            </>
          )}

          <div className="ml-auto flex border border-charcoal/20">
            <button
              type="button"
              onClick={() => zoom(1.4)}
              aria-label="Zoom in"
              className="flex h-10 w-10 items-center justify-center hover:bg-sand/30"
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => zoom(1 / 1.4)}
              aria-label="Zoom out"
              className="flex h-10 w-10 items-center justify-center border-l border-charcoal/20 hover:bg-sand/30"
            >
              <Minus size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={resetView}
              aria-label="Reset view"
              className="flex h-10 w-10 items-center justify-center border-l border-charcoal/20 hover:bg-sand/30"
            >
              <Maximize2 size={13} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div
          className={`relative mt-5 aspect-[16/10] w-full overflow-hidden border border-charcoal/15 bg-sand/20 ${
            mode === "draw" ? "cursor-crosshair" : "cursor-grab"
          }`}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerLeave={handleCanvasPointerUp}
          onClick={handleCanvasClick}
        >
          <div
            className="absolute inset-0 origin-center"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full select-none object-contain"
            />

            <svg
              ref={svgRef}
              viewBox={`0 0 ${imageWidth} ${imageHeight}`}
              preserveAspectRatio="xMidYMid meet"
              className="absolute inset-0 h-full w-full"
            >
              {shapes.map((shape) => {
                const isSelected = shape.key === selectedKey;
                const centroid = polygonCentroid(shape.points);
                const plot = plots.find(
                  (option) => option.id === shape.plotId
                );

                return (
                  <g key={shape.key}>
                    <polygon
                      points={toSvgPoints(
                        shape.points,
                        imageWidth,
                        imageHeight
                      )}
                      fill={fillFor(shape)}
                      stroke={strokeFor(shape)}
                      strokeWidth={isSelected ? 3 : 1.5}
                      strokeDasharray={
                        shape.kind === "PLOT" && !shape.plotId ? "6 4" : undefined
                      }
                      vectorEffect="non-scaling-stroke"
                      onClick={(event) => {
                        if (mode === "draw") return;
                        event.stopPropagation();
                        setSelectedKey(shape.key);
                      }}
                      className="cursor-pointer"
                    />

                    {/* Vertex handles, only on the selected shape. */}
                    {isSelected &&
                      canEdit &&
                      shape.points.map((point, index) => (
                        <circle
                          key={index}
                          cx={point.x * imageWidth}
                          cy={point.y * imageHeight}
                          r={Math.max(4, imageWidth / 260) / scale}
                          fill="#FAF7F0"
                          stroke="#2B2B27"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            (
                              event.target as Element
                            ).setPointerCapture?.(event.pointerId);
                            draggingVertex.current = {
                              key: shape.key,
                              index,
                            };
                          }}
                          className="cursor-move"
                        />
                      ))}

                    {(plot || shape.label) && (
                      <text
                        x={centroid.x * imageWidth}
                        y={centroid.y * imageHeight}
                        textAnchor="middle"
                        dominantBaseline="central"
                        pointerEvents="none"
                        style={{
                          fontSize: `${Math.max(10, imageWidth / 90)}px`,
                          fill: "#2B2B27",
                          paintOrder: "stroke",
                          stroke: "rgba(250, 247, 240, 0.9)",
                          strokeWidth: 3,
                        }}
                      >
                        {plot?.plotNumber ?? shape.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* In-progress polygon */}
              {draft.length > 0 && (
                <>
                  <polyline
                    points={toSvgPoints(draft, imageWidth, imageHeight)}
                    fill="rgba(214, 166, 46, 0.20)"
                    stroke="#B98C1E"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                  {draft.map((point, index) => (
                    <circle
                      key={index}
                      cx={point.x * imageWidth}
                      cy={point.y * imageHeight}
                      r={Math.max(4, imageWidth / 260) / scale}
                      fill={index === 0 ? "#B98C1E" : "#FAF7F0"}
                      stroke="#2B2B27"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ))}
                </>
              )}
            </svg>
          </div>

          <p className="pointer-events-none absolute bottom-3 left-3 text-[10px] uppercase tracking-[0.2em] text-charcoal/45">
            {mode === "draw"
              ? "Click to place points · Click the first point or press Enter to close"
              : "Click a boundary to select · Drag its handles to reshape"}
          </p>
        </div>
      </div>

      {/* ---------------- Inspector ---------------- */}
      <aside className="xl:col-span-4">
        <div className="border border-charcoal/10 p-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-serif text-h4">Boundaries</h2>
            <span className="text-[11px] uppercase tracking-[0.2em] text-muted">
              {shapes.length}
            </span>
          </div>

          {unbound > 0 && (
            <p className="mt-4 border border-earth/40 bg-earth/5 px-4 py-3 text-[12px] leading-relaxed text-earth">
              {unbound} boundar{unbound === 1 ? "y has" : "ies have"} no plot
              attached. They will render as dead areas on the public plan.
            </p>
          )}

          {selected ? (
            <div className="mt-6 space-y-6 border-t border-charcoal/10 pt-6">
              <label className="block">
                <span className="label-admin">Type</span>
                <select
                  value={selected.kind}
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateSelected({
                      kind: event.target.value as LayoutShapeKind,
                      ...(event.target.value !== "PLOT"
                        ? { plotId: null }
                        : {}),
                    })
                  }
                  className="field-admin mt-2"
                >
                  {(
                    Object.keys(SHAPE_KIND_LABELS) as LayoutShapeKind[]
                  ).map((kind) => (
                    <option key={kind} value={kind}>
                      {SHAPE_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>

              {selected.kind === "PLOT" ? (
                <label className="block">
                  <span className="label-admin">Plot</span>
                  <select
                    value={selected.plotId ?? ""}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateSelected({ plotId: event.target.value || null })
                    }
                    className="field-admin mt-2"
                  >
                    <option value="">Not attached</option>
                    {plots.map((plot) => (
                      <option
                        key={plot.id}
                        value={plot.id}
                        disabled={takenPlotIds.has(plot.id)}
                      >
                        {plot.plotNumber} —{" "}
                        {PLOT_STATUS_STYLES[plot.status].label}
                        {takenPlotIds.has(plot.id) ? " (already drawn)" : ""}
                      </option>
                    ))}
                  </select>
                  <span className="mt-2 block text-[11px] text-muted">
                    Colour, price and availability come from the plot record —
                    nothing is duplicated here.
                  </span>
                </label>
              ) : (
                <label className="block">
                  <span className="label-admin">Label</span>
                  <input
                    value={selected.label}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateSelected({ label: event.target.value })
                    }
                    placeholder="Clubhouse"
                    className="field-admin mt-2"
                  />
                </label>
              )}

              <p className="text-[11px] text-muted">
                {selected.points.length} points
              </p>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setShapes((prev) =>
                      prev.filter((shape) => shape.key !== selected.key)
                    );
                    setSelectedKey(null);
                    markDirty();
                  }}
                  className="btn-admin-danger w-full"
                >
                  <Trash2 size={13} strokeWidth={1.5} />
                  Delete boundary
                </button>
              )}
            </div>
          ) : (
            <p className="mt-6 border-t border-charcoal/10 pt-6 text-admin-body text-muted">
              {shapes.length === 0
                ? "Switch to Draw and trace the first plot boundary."
                : "Select a boundary on the plan to attach it to a plot."}
            </p>
          )}
        </div>

        {canEdit && (
          <div className="sticky bottom-4 mt-6">
            {error && (
              <p
                role="alert"
                className="mb-4 border border-danger/30 bg-danger/5 px-4 py-3 text-admin-body text-danger"
              >
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="btn-admin-solid w-full"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving
                </>
              ) : saved ? (
                <>
                  <Check size={14} />
                  Saved
                </>
              ) : dirty ? (
                "Save boundaries"
              ) : (
                "No changes"
              )}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
