/**
 * The roof report as a PDF: a cover, then only the sections the report has. It
 * is drawn from `PdfContent` (content.ts), which has already cleaned and cut
 * every piece of text, so nothing here reads the raw report. Letter size, the
 * PDF's own fonts.
 */
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import type { PdfContent } from './content';
import { Footer, Section, styles } from './shared';

export interface RoofReportPDFProps {
  content: PdfContent;
  /** The two charts as PNG pictures, when they could be drawn. */
  charts: { storm: string | null; damage: string | null };
}

const cell = (flex: number, align: 'left' | 'right' = 'left') => ({ flex, textAlign: align } as const);

export function RoofReportPDF({ content: c, charts }: RoofReportPDFProps) {
  const hasBody = c.sections.length > 0;
  return (
    <Document title={`Roof report, ${c.cover.address}`.slice(0, 200)} author={c.cover.company || undefined} creator="Archie" producer="Archie">
      <Page size="LETTER" style={styles.coverPage}>
        <View style={styles.coverBand}><Text style={styles.coverCompany}>{c.cover.company || 'Roof report'}</Text></View>
        <View style={styles.coverBody}>
          <Text style={styles.coverTitle}>{c.cover.title}</Text>
          <Text style={styles.coverAddress}>{c.cover.address}</Text>
          {c.cover.cityStateZip ? <Text style={styles.coverLine}>{c.cover.cityStateZip}</Text> : null}
          <View style={styles.coverMeta}>
            {c.cover.customer ? <View style={styles.metaRow}><Text style={styles.metaLabel}>Prepared for</Text><Text>{c.cover.customer}</Text></View> : null}
            {c.cover.inspected ? <View style={styles.metaRow}><Text style={styles.metaLabel}>Inspected</Text><Text>{c.cover.inspected}</Text></View> : null}
            {c.cover.made ? <View style={styles.metaRow}><Text style={styles.metaLabel}>Report date</Text><Text>{c.cover.made}</Text></View> : null}
          </View>
        </View>
      </Page>

      <Page size="LETTER" style={styles.page} wrap>
        {c.summary || c.condition.length ? (
          <Section title="Summary">
            {c.condition.map((l) => <Text key={l} style={styles.p}>{l}</Text>)}
            {c.summary ? <Text style={styles.p}>{c.summary}</Text> : null}
          </Section>
        ) : null}

        {c.findings.length ? (
          <Section title="Findings">
            {c.findings.map((f, i) => (
              <View key={i} style={styles.card} wrap={false}>
                <Text style={styles.h3}>{f.title || 'Finding'}  ({f.severity})</Text>
                {f.narrative ? <Text style={styles.p}>{f.narrative}</Text> : null}
                {f.action ? <Text style={styles.small}>What to do: {f.action}</Text> : null}
              </View>
            ))}
          </Section>
        ) : null}

        {c.damage.length ? (
          <Section title="Damage found">
            {charts.damage ? <Image src={charts.damage} style={styles.chart} /> : null}
            <View style={styles.headRow}><Text style={cell(3)}>Kind</Text><Text style={cell(1, 'right')}>Count</Text><Text style={cell(1, 'right')}>Severity</Text></View>
            {c.damage.map((d, i) => <View key={i} style={styles.row} wrap={false}><Text style={cell(3)}>{d.label}</Text><Text style={cell(1, 'right')}>{d.count}</Text><Text style={cell(1, 'right')}>{d.severity}</Text></View>)}
          </Section>
        ) : null}

        {c.storm ? (
          <Section title="Storm history">
            {c.storm.lines.map((l) => <Text key={l} style={styles.p}>{l}</Text>)}
            {charts.storm ? <Image src={charts.storm} style={styles.chart} /> : null}
          </Section>
        ) : null}

        {c.estimate ? (
          <Section title="Estimate">
            <View style={styles.headRow}><Text style={cell(4)}>Item</Text><Text style={cell(2, 'right')}>Quantity</Text><Text style={cell(2, 'right')}>Each</Text><Text style={cell(2, 'right')}>Total</Text></View>
            {c.estimate.rows.map((r, i) => <View key={i} style={styles.row} wrap={false}><Text style={cell(4)}>{r.item}</Text><Text style={cell(2, 'right')}>{r.quantity}</Text><Text style={cell(2, 'right')}>{r.each}</Text><Text style={cell(2, 'right')}>{r.total}</Text></View>)}
            <View style={{ ...styles.row, borderBottomWidth: 0 }}><Text style={{ ...cell(8), fontFamily: 'Helvetica-Bold' }}>Total</Text><Text style={{ ...cell(2, 'right'), fontFamily: 'Helvetica-Bold' }}>{c.estimate.total}</Text></View>
          </Section>
        ) : null}

        {c.measurements ? <Section title="Measurements">{c.measurements.lines.map((l) => <Text key={l} style={styles.p}>{l}</Text>)}</Section> : null}

        {c.photos.length ? (
          <Section title="Photos">
            <View style={styles.photoGrid}>
              {c.photos.map((p, i) => (
                <View key={i} style={styles.photoCell} wrap={false}>
                  <Image src={p.dataUrl} style={{ width: '100%', height: 110, objectFit: 'cover' }} />
                  {p.caption ? <Text style={{ ...styles.small, marginTop: 2 }}>{p.caption}</Text> : null}
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {c.notes ? <Section title="Notes"><Text style={styles.p}>{c.notes}</Text></Section> : null}

        {!hasBody ? <Text style={styles.p}>This report has no written findings yet.</Text> : null}
        <Text style={{ ...styles.small, marginTop: 14 }}>{c.disclaimer}</Text>
        <Footer text={c.footer || c.cover.address} />
      </Page>
    </Document>
  );
}
