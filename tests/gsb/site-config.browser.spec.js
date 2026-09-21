// A fork's server-provided labels must render as text without changing Stanford defaults or auth mechanics.
import {test,expect} from '@playwright/test';
test('custom cohort and email labels fit phone and desktop and cannot inject markup',async({page})=>{
  await page.route('**/api/session',async route=>{
    const response=await route.fetch(),body=await response.json();
    body.site={cohortLabel:'Example alumni <script>bad()</script>',emailLabel:'Your email address',emailPlaceholder:'you@example.edu',emailHint:'No password. Any verified example.edu address can play.'};
    await route.fulfill({response,json:body});
  });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.getByLabel('Your email address')).toHaveAttribute('placeholder','you@example.edu');
  await expect(page.getByText('Example alumni <script>bad()</script>',{exact:true})).toBeVisible();
  for(const [width,height] of [[390,844],[1365,900]]){
    await page.setViewportSize({width,height});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
