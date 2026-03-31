export function ScaleControl({
  minimap,
  scale,
  onScaleChange,
}: {
  minimap: React.ReactNode;
  scale: number;
  onScaleChange: (value: number) => void;
}) {
  return (
    <div className="nancy-scale-panel">
      {minimap}
      <div className="nancy-scale-row">
        <input
          className="nancy-scale-slider"
          type="range"
          min="0.25"
          max="1.25"
          step="0.05"
          value={scale}
          onChange={(event) => onScaleChange(Number(event.target.value))}
        />
        <div className="nancy-scale-value">{Math.round(scale * 100)}%</div>
      </div>
    </div>
  );
}
