/* Golden fixture for filled form fields, which saving paints (flattens) into
   the page.

   The field descriptors are what forms.js reads from pdf.js for each widget;
   the values are what the Form panel collected. Text on one line (sized from
   the box, or the field's own size, or the 6pt floor), text over several lines
   (explicit breaks, word wrap, and lines that run out of box), a number, a
   choice, checkboxes on / off / true and with no export value, a radio pair,
   blank and whitespace-only answers, a rectangle given corner-first the wrong
   way round, and a page turned by 90 degrees. */

export async function makeFormsFixture(PDFLib) {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([595.28, 841.89]);
  d.addPage([595.28, 841.89]);
  const src = { id: 'forms', name: 'forms.pdf', bytes: await d.save() };

  const tx = (name, rect, more) => ({ name, type: 'Tx', rect, multiline: false, fontSize: 0, ...more });
  const btn = (name, rect, exportValue, more) => ({
    name,
    type: 'Btn',
    rect,
    exportValue,
    checkbox: true,
    ...more,
  });

  const page1 = [
    tx('name', [60, 760, 300, 780]),
    tx('company', [60, 730, 300, 744]),
    tx('tiny', [60, 710, 200, 718]),
    tx('sized', [60, 670, 300, 700], { fontSize: 14 }),
    tx('long', [60, 640, 200, 656]),
    tx('qty', [320, 760, 380, 780]),
    { name: 'pick', type: 'Ch', rect: [320, 730, 480, 746], fontSize: 0, options: [] },
    tx('blank', [320, 700, 480, 716]),
    tx('spaces', [320, 670, 480, 686]),
    tx('never', [320, 640, 480, 656]),
    tx('backwards', [300, 620, 60, 600]),
    tx('notes', [60, 440, 300, 580], { multiline: true }),
    tx('overflow', [320, 540, 480, 580], { multiline: true, fontSize: 10 }),
    btn('agree', [60, 400, 74, 414], 'Yes'),
    btn('newsletter', [90, 400, 104, 414], 'Yes'),
    btn('bool', [120, 400, 134, 414], undefined),
    btn('noexport', [150, 400, 170, 420], undefined),
    btn('size', [200, 400, 212, 412], 'S', { checkbox: false, radio: true }),
    btn('size', [220, 400, 232, 412], 'M', { checkbox: false, radio: true }),
    btn('wide', [260, 395, 320, 415], 'On'),
  ];
  const page2 = [tx('turned', [60, 760, 300, 780]), btn('turnedTick', [60, 730, 74, 744], 'Yes')];

  const items = [
    { src, num: 1, rot: 0, crop: null, shapes: [], fields: page1 },
    { src, num: 2, rot: 90, crop: null, shapes: [], fields: page2 },
  ];
  const values = {
    name: 'A. N. Other',
    company: 'Add Dots Engineering',
    tiny: 'Small box',
    sized: 'Fourteen point',
    long: 'This answer is far too long to sit on one line of a narrow box',
    qty: 42,
    pick: 'Option two',
    blank: '',
    spaces: '   ',
    backwards: 'Corners given the other way round',
    notes:
      'First line\nSecond line, after a break\n\nA paragraph long enough to wrap onto more than one line ' +
      'inside the box, word by word.',
    overflow: 'One\nTwo\nThree\nFour\nFive\nSix',
    agree: 'Yes',
    newsletter: 'Off',
    bool: true,
    noexport: 'On',
    size: 'M',
    wide: 'Yes',
    turned: 'On a turned page',
    turnedTick: 'Yes',
  };
  return { items, values };
}
