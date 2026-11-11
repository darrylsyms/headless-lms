import React from "react";
import { Document, Page, Text, View, Image, Link, StyleSheet, Font, pdf } from "@react-pdf/renderer";

type Node = { type?: string; text?: string; children?: Node[]; url?: string; assetId?: string; caption?: Node[]; listStyleType?: string; indent?: number; checked?: boolean; listStart?: number; [key: string]: unknown };
const styles = StyleSheet.create({
  page: { paddingHorizontal: 48, paddingTop: 75, paddingBottom: 86, fontFamily: "Noto Sans", fontSize: 10.5, lineHeight: 1.5, color: "#202124", backgroundColor: "#fff" },
  title: { fontSize: 24, fontFamily: "Noto Sans", fontWeight: "bold", marginBottom: 20 },
  h1: { fontSize: 21, fontFamily: "Noto Sans", fontWeight: "bold", marginTop: 16, marginBottom: 12, lineHeight: 1.15 },
  h2: { fontSize: 17, fontFamily: "Noto Sans", fontWeight: "bold", marginTop: 16, marginBottom: 12, lineHeight: 1.15 },
  h3: { fontSize: 13, fontFamily: "Noto Sans", fontWeight: "bold", marginTop: 16, marginBottom: 12, lineHeight: 1.15 },
  p: { marginBottom: 9 }, quote: { borderLeftWidth: 2, borderLeftColor: "#aaa", paddingLeft: 10, marginVertical: 8 },
  code: { fontFamily: "Courier", fontSize: 9, backgroundColor: "#f2f2f2", padding: 8, marginVertical: 8 },
  image: { maxWidth: "100%", maxHeight: 600, objectFit: "contain", marginVertical: 8 },
  caption: { fontSize: 9, color: "#555", marginBottom: 8 },
  row: { flexDirection: "row" }, cell: { flexGrow: 1, flexBasis: 0, borderWidth: 0.5, borderColor: "#aaa", padding: 5 },
  link: { color: "#2755a5", textDecoration: "underline" }, rule: { borderBottomWidth: 1, borderBottomColor: "#bbb", marginVertical: 10 },
  headerTitle: { position: "absolute", top: 23, left: 48, right: 48, fontSize: 8, lineHeight: 1.25, color: "#555", maxLines: 2, textOverflow: "ellipsis" },
  headerRule: { position: "absolute", top: 52, left: 48, right: 48, borderBottomWidth: 0.5, borderBottomColor: "#c8c8c8" },
  footerRule: { position: "absolute", top: 788, left: 48, right: 48, borderTopWidth: 0.5, borderTopColor: "#c8c8c8" },
  footerBrand: { position: "absolute", top: 796, left: 48, width: 75, fontSize: 8, fontWeight: "bold", color: "#202124" },
  footerPage: { position: "absolute", top: 796, right: 48, width: 70, fontSize: 8, color: "#555", textAlign: "right" },
});

function textContent(nodes: Node[] = []): string {
  return nodes.map((node) => typeof node.text === "string" ? node.text : textContent(node.children)).join("");
}
function musicText(value: string): React.ReactNode {
  return value.split(/([\u2669-\u266f])/).map((part, i) => /[\u2669-\u266f]/.test(part) ? <Text key={i} style={{ fontFamily: "Noto Music", fontWeight: "normal", fontStyle: "normal" }}>{part}</Text> : part);
}
function inline(nodes: Node[] = []): React.ReactNode {
  return nodes.map((node, i) => {
    if (typeof node.text === "string") {
      return <Text key={i} style={{ fontFamily: node.code ? "Courier" : "Noto Sans", fontWeight: node.bold ? "bold" : undefined, fontStyle: node.italic ? "italic" : undefined, textDecoration: node.underline && node.strikethrough ? "underline line-through" : node.underline ? "underline" : node.strikethrough ? "line-through" : "none" }}>{musicText(node.text)}</Text>;
    }
    if (node.type === "a" && typeof node.url === "string" && /^https?:/i.test(node.url)) return <Link key={i} src={node.url} style={styles.link}>{inline(node.children)}</Link>;
    return <Text key={i}>{inline(node.children)}</Text>;
  });
}
function source(node: Node, assets: Record<string, string>, activityId?: string) {
  if (node.type === "img" && node.assetId && activityId) return `/api/activity-export/${encodeURIComponent(activityId)}/images/${encodeURIComponent(node.assetId)}`;
  return (node.assetId && assets[node.assetId]) || node.url || "";
}
function blocks(nodes: Node[], assets: Record<string, string>, images: Map<string, string | null>, activityId?: string): React.ReactNode {
  let listNumber = 0;
  return nodes.map((node, i) => {
    const kind = node.type || "p";
    const children = Array.isArray(node.children) ? node.children : [];
    if (kind === "video" || kind === "file") return null;
    if (kind === "media_embed") {
      const url = source(node, assets, activityId);
      if (/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\//i.test(url)) return null;
      return url ? <Text key={i} style={styles.p}><Link src={url} style={styles.link}>{url}</Link></Text> : null;
    }
    if (kind === "img") {
      const url = source(node, assets, activityId);
      const image = images.get(url);
      return <View key={i} wrap={false}>{image ? <Image src={image} style={styles.image} /> : <Text style={styles.caption}>[Image unavailable{url ? `: ${url}` : ""}]</Text>}{node.caption && <Text style={styles.caption}>{textContent(node.caption)}</Text>}</View>;
    }
    if (kind === "table") return <View key={i} style={{ marginVertical: 8 }}>{children.map((row, j) => <View key={j} style={styles.row} wrap={false}>{(row.children ?? []).map((cell, k) => <View key={k} style={{ ...styles.cell, fontWeight: cell.type === "th" ? "bold" : "normal" }}>{blocks(cell.children ?? [], assets, images, activityId)}</View>)}</View>)}</View>;
    if (kind === "hr") return <View key={i} style={styles.rule} />;
    if (kind === "audio") {
      const url = source(node, assets, activityId);
      const label = String(node.name || (kind === "audio" ? "Audio" : "File"));
      return <Text key={i} style={styles.p}>{url && /^https?:/i.test(url) ? <Link src={url} style={styles.link}>{label}</Link> : label}</Text>;
    }
    if (kind === "code_block") return <Text key={i} style={styles.code}>{children.map((line) => textContent(line.children)).join("\n")}</Text>;
    if (["column_group", "column", "callout", "toggle"].includes(kind)) return <View key={i} style={kind === "callout" ? styles.quote : undefined}>{blocks(children, assets, images, activityId)}</View>;
    const heading = kind === "h1" ? styles.h1 : kind === "h2" ? styles.h2 : kind === "h3" ? styles.h3 : styles.p;
    if (node.listStyleType) {
      listNumber = node.listStart || listNumber + 1;
      const marker = node.listStyleType === "decimal" ? `${listNumber}.` : node.listStyleType === "todo" ? node.checked ? "[x]" : "[ ]" : "•";
      return <Text key={i} style={{ ...styles.p, marginLeft: Math.max(0, Number(node.indent || 1) - 1) * 16 }}>{marker}  {inline(children)}</Text>;
    }
    listNumber = 0;
    if (kind === "blockquote") return <View key={i} style={styles.quote}><Text>{inline(children)}</Text></View>;
    return <Text key={i} style={heading}>{inline(children)}</Text>;
  });
}

async function loadImage(url: string): Promise<string | null> {
  try {
    if (!url || !/^(https?:|data:|\/)/i.test(url)) return null;
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!/^image\/(png|jpeg)$/i.test(blob.type)) {
      if (!blob.type.startsWith("image/")) return null;
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) { bitmap.close(); return null; }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return canvas.toDataURL("image/png");
    }
    return await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null); reader.onerror = () => resolve(null); reader.readAsDataURL(blob); });
  } catch { return null; }
}

export async function createActivityPdf(title: string, config: unknown, assets: Record<string, string>, activityId?: string): Promise<{ blob: Blob; missingImages: number }> {
  const base = `${window.location.origin}/fonts/noto-sans`;
  Font.register({ family: "Noto Sans", fonts: [
    { src: `${base}/NotoSans-Regular.ttf`, fontWeight: 400 },
    { src: `${base}/NotoSans-Bold.ttf`, fontWeight: 700 },
    { src: `${base}/NotoSans-Italic.ttf`, fontWeight: 400, fontStyle: "italic" },
    { src: `${base}/NotoSans-BoldItalic.ttf`, fontWeight: 700, fontStyle: "italic" },
  ] });
  Font.register({ family: "Noto Music", src: `${base}/NotoMusic-Regular.ttf` });
  const nodes = Array.isArray(config) ? config as Node[] : [];
  const urls = new Set<string>();
  const visit = (items: Node[]) => items.forEach((node) => { if (node.type === "img") urls.add(source(node, assets, activityId)); if (Array.isArray(node.children)) visit(node.children); });
  visit(nodes);
  const images = new Map(await Promise.all([...urls].map(async (url) => [url, await loadImage(url)] as const)));
  const blob = await pdf(
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.headerTitle} fixed>{musicText(title)}</Text>
        <View style={styles.headerRule} fixed />
        <View style={styles.footerRule} fixed />
        <Text style={styles.footerBrand} fixed>Fretwise.</Text>
        <Text style={styles.footerPage} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        <Text style={styles.title}>{musicText(title)}</Text>
        {blocks(nodes, assets, images, activityId)}
      </Page>
    </Document>,
  ).toBlob();
  return { blob, missingImages: [...images.values()].filter((value) => !value).length };
}
