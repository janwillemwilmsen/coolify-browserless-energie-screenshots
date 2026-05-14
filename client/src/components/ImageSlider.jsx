import { useState, useRef, useCallback, useEffect } from "react";

export default function ImageSlider({ beforeSrc, afterSrc, beforeLabel, afterLabel }) {
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef(null);

  const updatePosition = useCallback((clientX) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPosition(pct);
  }, []);

  const handlePointerDown = useCallback((e) => {
    setDragging(true);
    updatePosition(e.clientX);
    e.preventDefault();
  }, [updatePosition]);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e) => {
      updatePosition(e.clientX || e.touches?.[0]?.clientX);
    };
    const handleUp = () => setDragging(false);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove);
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [dragging, updatePosition]);

  return (
    <div
      className="image-slider"
      ref={containerRef}
      onMouseDown={handlePointerDown}
      onTouchStart={(e) => {
        setDragging(true);
        updatePosition(e.touches[0].clientX);
      }}
    >
      {/* After (bottom layer — full width) */}
      <img src={afterSrc} alt={afterLabel} draggable={false} />

      {/* Before (top layer — clipped) */}
      <div
        className="slider-layer-before"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img src={beforeSrc} alt={beforeLabel} draggable={false} />
      </div>

      {/* Divider line */}
      <div className="slider-divider" style={{ left: `${position}%` }} />

      {/* Handle */}
      <div className="slider-handle" style={{ left: `${position}%` }}>
        ◄►
      </div>

      {/* Labels */}
      <div className="slider-labels">
        <span className="slider-label">{beforeLabel}</span>
        <span className="slider-label">{afterLabel}</span>
      </div>
    </div>
  );
}
