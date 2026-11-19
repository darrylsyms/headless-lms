export function integrationName(id: string): string {
  return id === "amazon-ses" ? "Amazon SES" : id.charAt(0).toUpperCase() + id.slice(1);
}
