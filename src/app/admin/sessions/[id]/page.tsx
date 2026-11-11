import type { Metadata } from "next";
import SessionDetail from "@/components/SessionDetail";

export const metadata: Metadata = {
  title: "会话详情",
};

/** 页面依赖运行时 id，不参与预渲染；显式声明为阻塞路由，避免 Cache Components 报错 */
export const instant = false;

/** Next 16：动态路由的 params 是 Promise，页面是服务端组件，先 await 再交给客户端组件拉数据 */
export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SessionDetail id={id} />;
}
