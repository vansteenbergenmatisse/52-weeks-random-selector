export interface ReelItem {
  id: string;
  colorKey: "red" | "blue" | "purple" | "charcoal";
  emoji?: string | null;
  posterUrl?: string | null;
  title?: string;
}

const FACE: Record<ReelItem["colorKey"], string> = {
  red: "from-card-red to-card-red-2",
  blue: "from-card-blue to-card-blue-2",
  purple: "from-card-purple to-card-purple-2",
  charcoal: "from-card-charcoal to-card-charcoal-2",
};

export function CarouselCard({
  item,
  width,
  height,
  dim,
}: {
  item: ReelItem;
  width: number;
  height: number;
  dim?: boolean;
}) {
  return (
    <div
      className={`rounded-lg overflow-hidden shadow-card bg-gradient-to-b ${FACE[item.colorKey]} border border-black/40 grid place-items-center`}
      style={{ width, height, filter: dim ? "brightness(0.82)" : undefined }}
    >
      {item.posterUrl ? (
        <img src={item.posterUrl} alt={item.title ?? ""} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span style={{ fontSize: Math.round(height * 0.42) }} className="drop-shadow">
          {item.emoji ?? "🎲"}
        </span>
      )}
    </div>
  );
}
