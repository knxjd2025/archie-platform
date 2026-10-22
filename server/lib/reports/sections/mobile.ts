/**
 * The phone layer every report carries — the document reports (Inspection,
 * Estimate, Combined, the commercial Inspection) through premiumShell, and the
 * scroll-craft reports (Proposal, Presentation, residential and commercial)
 * next to the engine's own CSS and JS.
 *
 * At phone width a table with three or more columns does not fit: the
 * estimate's Total column ran off the edge and the "Why it matters" text was
 * squeezed into a column two words wide. Below 640px such a table becomes a
 * stack of cards — the first cell is the card's title across the full width,
 * every other cell sits beneath it under its own column heading. The script
 * copies each heading onto its cells as data-label, so no renderer has to.
 *
 * The rest is spacing and reading size: two short facts to a row instead of
 * one, long-form text no smaller than 13.5px, and less dead air between
 * scroll-craft chapters. Nothing here applies above 640px or in print.
 */

export const MOBILE_CSS = `
@media screen and (max-width: 640px) {
  table.rt-stack { display: block; width: 100%; border: 0; background: none; border-radius: 0; overflow: visible; }
  table.rt-stack thead { display: none; }
  table.rt-stack tbody, table.rt-stack tfoot { display: block; }
  table.rt-stack tr {
    display: grid; grid-template-columns: repeat(var(--rt-cols, 2), minmax(0, 1fr)); gap: 10px 14px;
    padding: 14px 16px; margin: 0 0 10px; border-radius: 12px;
    /* The document theme's white card; scroll-craft has no --card, and its tables can sit on a dark chapter. */
    background: var(--card, color-mix(in srgb, currentColor 4%, transparent)) !important;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  }
  table.rt-stack td, table.rt-stack th {
    display: block; min-width: 0; padding: 0 !important; border: 0 !important; background: none !important;
    text-align: left !important; overflow-wrap: anywhere;
  }
  table.rt-stack tr > :first-child { grid-column: 1 / -1; }
  table.rt-stack tbody tr > td:first-child:not(:has(div, b)) { font-weight: 600; font-size: 15px; }
  table.rt-stack td[data-label]::before {
    content: attr(data-label); display: block; margin-bottom: 3px;
    font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; opacity: .6;
  }
  /* A row that spans columns (an estimate total, a one-line note) reads as a
     label and its value on one line, not as a card with headings. */
  table.rt-stack tr.rt-row-span { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; }
  table.rt-stack tr.rt-row-span > :first-child { flex: 1 1 auto; }
  table.rt-stack tr.rt-row-span td::before { content: none; }
  /* A tick matrix (what each tier includes) stays a table — fifteen cards of
     three ticks is longer and harder to compare — just one that fits. */
  table.rt-compact { display: table; table-layout: fixed; font-size: 13px; }
  table.rt-compact th, table.rt-compact td { padding: 9px 5px !important; hyphens: auto; -webkit-hyphens: auto; }
  table.rt-compact tbody td:not(:first-child) { font-size: 12.5px; }
  table.rt-compact tr > :first-child { width: 40%; padding-left: 12px !important; }
  table.rt-compact thead th { font-size: 12px; }

  .fact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .fact-grid > .fact.rt-long { grid-column: 1 / -1; }
  .fact b, .fact span { overflow-wrap: anywhere; }

  .tiny, .muted.tiny, .sc-body.tiny, .found-why, .photo .cap { font-size: 13.5px !important; line-height: 1.55; }
  .cards3 { grid-template-columns: 1fr !important; }
  /* Damage photos that carry a "why it matters" paragraph get the full width; a bare photo record stays two-up. */
  .photogrid:has(.cap div) { grid-template-columns: 1fr !important; }
  .photo .cap div { font-size: 13.5px !important; }

  /* Documents: the print button rides with the cover instead of sitting over the text all the way down. */
  .print-btn { position: absolute !important; top: 10px !important; right: 10px !important; }

  /* Scroll-craft: chapters were 72px of padding top and bottom, 128px on the big ones. */
  :root { --sc-section: 3.25rem; }
  .ch--peak, .ch--investment, .ch--close { padding-block: var(--sc-8, 4rem) !important; }
}
`;

/** Labels table cells with their column heading and marks the tables the CSS above turns into cards. */
export const MOBILE_JS = `
(function () {
  function stackTables() {
    var tables = document.querySelectorAll('table');
    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];
      var head = table.tHead && table.tHead.rows[0];
      if (!head || head.cells.length < 3) continue;
      if (table.querySelector('tbody td.yes, tbody td.no')) { table.classList.add('rt-compact'); continue; }
      var labels = [];
      for (var h = 0; h < head.cells.length; h++) {
        var span = head.cells[h].colSpan || 1;
        for (var s = 0; s < span; s++) labels.push((head.cells[h].textContent || '').trim());
      }
      table.classList.add('rt-stack');
      table.style.setProperty('--rt-cols', String(Math.max(1, labels.length - 1)));
      var rows = table.querySelectorAll('tbody tr, tfoot tr');
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].cells, col = 0, spans = false;
        for (var c = 0; c < cells.length; c++) {
          var cell = cells[c];
          if ((cell.colSpan || 1) > 1) spans = true;
          if (col > 0 && labels[col] && !cell.hasAttribute('data-label')) cell.setAttribute('data-label', labels[col]);
          col += cell.colSpan || 1;
        }
        if (spans || cells.length < labels.length) rows[r].classList.add('rt-row-span');
      }
    }
    var facts = document.querySelectorAll('.fact-grid > .fact');
    for (var f = 0; f < facts.length; f++) {
      var value = facts[f].querySelector('span');
      if (value && (value.textContent || '').trim().length > 34) facts[f].classList.add('rt-long');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stackTables);
  else stackTables();
})();
`;
