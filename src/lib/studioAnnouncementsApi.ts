export type StudioAnnouncement = {
  id: string;
  title: string;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
  read: boolean;
};

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
  read: number;
};

function mapRow(row: AnnouncementRow): StudioAnnouncement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    author_id: row.author_id,
    author_name: row.author_name,
    created_at: row.created_at,
    read: Boolean(row.read),
  };
}

export async function fetchAnnouncements(): Promise<{
  announcements: StudioAnnouncement[];
  unreadCount: number;
}> {
  const res = await fetch("/api/announcements", { credentials: "same-origin" });
  const data = (await res.json()) as {
    announcements?: AnnouncementRow[];
    unreadCount?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || "加载公告失败");
  const announcements = (data.announcements || []).map(mapRow);
  return { announcements, unreadCount: data.unreadCount ?? announcements.filter((a) => !a.read).length };
}

export async function markAnnouncementRead(id: string): Promise<void> {
  const res = await fetch(`/api/announcements/${encodeURIComponent(id)}/read`, {
    method: "POST",
    credentials: "same-origin",
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error || "标记已读失败");
}

export async function createAnnouncement(title: string, body: string): Promise<StudioAnnouncement> {
  const res = await fetch("/api/admin/announcements", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });
  const data = (await res.json()) as { announcement?: AnnouncementRow; error?: string };
  if (!res.ok) throw new Error(data.error || "发布公告失败");
  if (!data.announcement) throw new Error("发布公告失败");
  return mapRow(data.announcement);
}

export function formatAnnouncementTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
