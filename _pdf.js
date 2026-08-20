const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file:///Users/darya/Documents/workspace/cv.html');
  await p.pdf({ path: '/private/tmp/claude-501/-Users-darya-Documents-workspace/c6723ae5-7345-4b79-900c-059cdbba0471/scratchpad/cv.pdf', format: 'A4', printBackground: true });
  await b.close();
})();
