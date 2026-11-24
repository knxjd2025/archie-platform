/**
 * The small pieces the roof report PDF is made of. Fonts are the PDF's own
 * built-in ones (Helvetica): nothing is fetched from anywhere when a PDF is made.
 */
import { StyleSheet, Text, View } from '@react-pdf/renderer';

export const COLORS = { ink: '#111827', soft: '#4b5563', faint: '#9ca3af', rule: '#e5e7eb', accent: '#1d4ed8', wash: '#f3f4f6' } as const;

export const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 64, paddingHorizontal: 44, fontFamily: 'Helvetica', fontSize: 10, color: COLORS.ink, lineHeight: 1.4 },
  coverPage: { padding: 0, fontFamily: 'Helvetica', color: COLORS.ink },
  coverBand: { backgroundColor: COLORS.accent, paddingVertical: 36, paddingHorizontal: 44 },
  coverCompany: { color: '#ffffff', fontSize: 14, fontFamily: 'Helvetica-Bold' },
  coverBody: { paddingTop: 70, paddingHorizontal: 44 },
  coverTitle: { fontSize: 34, fontFamily: 'Helvetica-Bold' },
  coverAddress: { fontSize: 16, marginTop: 14 },
  coverLine: { fontSize: 12, color: COLORS.soft, marginTop: 4 },
  coverMeta: { marginTop: 40, borderTopWidth: 1, borderTopColor: COLORS.rule, paddingTop: 14 },
  metaRow: { flexDirection: 'row', marginBottom: 6 },
  metaLabel: { width: 90, color: COLORS.soft },
  h2: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 8, color: COLORS.accent },
  h3: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  p: { marginBottom: 6 },
  small: { fontSize: 9, color: COLORS.soft },
  card: { borderWidth: 1, borderColor: COLORS.rule, borderRadius: 4, padding: 8, marginBottom: 8 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.rule, paddingVertical: 4 },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.ink, paddingBottom: 4, fontFamily: 'Helvetica-Bold' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  photoCell: { width: '33.3333%', paddingHorizontal: 4, marginBottom: 10 },
  chart: { width: '100%', marginVertical: 6 },
  footer: { position: 'absolute', bottom: 28, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: COLORS.faint, borderTopWidth: 1, borderTopColor: COLORS.rule, paddingTop: 6 },
});

/** The line at the foot of every page but the cover: who made it, and which page. */
export function Footer({ text }: { text: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{text}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  );
}
