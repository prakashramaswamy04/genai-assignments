import { MAX_SCRIPT_BYTES } from "../shared/constants.js";

const OPTIONS = {
  playwright: [
    ["TypeScript", "ledge.spec.ts"], ["JavaScript", "ledge.spec.js"], ["Python", "test_ledge.py"],
    ["Java", "LedgeTest.java"], ["C#", "LedgeTests.cs"], ["Robot Framework (Browser)", "ledge.robot"],
  ],
  selenium: [
    ["Java", "LedgeTest.java"], ["Python", "test_ledge.py"], ["JavaScript", "ledge.spec.js"],
    ["C#", "LedgeTests.cs"], ["Robot Framework (SeleniumLibrary)", "ledge.robot"],
  ],
};

const quote = (value) => JSON.stringify(String(value));
const safeName = (value) => String(value || "test").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "test";
const masked = (value) => value === "••••••" || value === "<masked>" || value === "[REDACTED]" || value === "[MASKED]";
const valueFor = (step) => step.value !== undefined && !masked(step.value) ? String(step.value) : null;

function locatorFor(target = {}) {
  if (target.selector) return String(target.selector);
  if (target.cssSelector) return String(target.cssSelector);
  if (target.id) return `#${String(target.id).replace(/([^a-zA-Z0-9_-])/g, "\\$1")}`;
  if (target.name) return `[name=${quote(target.name)}]`;
  return null;
}

function gap(step, reason, language, gaps) {
  const text = `${step.action || step.actionType || "Step"}: ${reason}`;
  gaps.push(text);
  if (language.startsWith("Robot Framework")) return `    Log    TODO: ${text}`;
  return `${language === "Python" ? "# " : "// "}TODO: ${text}`;
}

function operation(step, framework, language, gaps) {
  const type = String(step.actionType || "").toLowerCase();
  const locator = locatorFor(step.target);
  const value = valueFor(step);
  if (step.frame?.length || step.target?.shadowPath?.length && framework === "selenium") {
    return gap(step, "frame or shadow-root traversal is not implemented in the local template.", language, gaps);
  }
  if (type === "navigate") {
    const url = step.url || step.target?.url;
    if (!url) return gap(step, "captured URL unavailable.", language, gaps);
    if (language.startsWith("Robot Framework")) return `    Go To    ${String(url).replace(/[\r\n\t]+/g, " ")}`;
    if (framework === "playwright") {
      if (language === "Python") return `    page.goto(${quote(url)})`;
      if (language === "Java") return `    page.navigate(${quote(url)});`;
      if (language === "C#") return `    await page.GotoAsync(${quote(url)});`;
      return `    await page.goto(${quote(url)});`;
    }
    if (language === "Python") return `    driver.get(${quote(url)})`;
    if (language === "Java") return `    driver.get(${quote(url)});`;
    if (language === "C#") return `    driver.Navigate().GoToUrl(${quote(url)});`;
    return `    await driver.get(${quote(url)});`;
  }
  if (!locator) return gap(step, "captured locator unavailable.", language, gaps);
  if (["input", "change"].includes(type) && value === null) return gap(step, "value was masked or not captured; provide safe test data.", language, gaps);
  if (type === "select" && value === null) return gap(step, "selected option value was not captured.", language, gaps);

  if (language.startsWith("Robot Framework")) {
    const robotLocator = `\u0000${locator}\u0000`;
    if (["click", "submit", "radio"].includes(type)) return `    ${framework === "playwright" ? "Click" : "Click Element"}    ${robotLocator}`;
    if (["input", "change"].includes(type)) return `    ${framework === "playwright" ? "Fill Text" : "Input Text"}    ${robotLocator}    ${String(value).replace(/[\r\n\t]+/g, " ")}`;
    if (type === "select") return `    ${framework === "playwright" ? "Select Options By" : "Select From List By Label"}    ${robotLocator}    ${String(value).replace(/[\r\n\t]+/g, " ")}`;
    if (type === "check") return step.target?.inputType === "radio"
      ? `    ${framework === "playwright" ? "Click" : "Click Element"}    ${robotLocator}`
      : `    ${step.checked === false ? "Unselect Checkbox" : "Select Checkbox"}    ${robotLocator}`;
    if (type === "keydown") return `    Press Keys    ${robotLocator}    ${step.key || "ENTER"}`;
    return gap(step, "action type is not supported by the local template.", language, gaps);
  }

  const css = quote(locator);
  if (framework === "playwright") {
    const py = language === "Python";
    const java = language === "Java";
    const cs = language === "C#";
    const el = java ? `page.locator(${css})` : cs ? `page.Locator(${css})` : `page.locator(${css})`;
    const asyncPrefix = py || java ? "" : "await ";
    const suffix = py ? "" : ";";
    if (["click", "submit", "radio"].includes(type)) return `${asyncPrefix}${el}.${cs ? "ClickAsync" : "click"}()${suffix}`;
    if (["input", "change"].includes(type)) return `${asyncPrefix}${el}.${cs ? "FillAsync" : "fill"}(${quote(value)})${suffix}`;
    if (type === "select") {
      if (py) return `${el}.select_option(label=${quote(value)})`;
      if (java) return `${el}.selectOption(new SelectOption().setLabel(${quote(value)}));`;
      if (cs) return `await ${el}.SelectOptionAsync(new SelectOptionValue { Label = ${quote(value)} });`;
      return `await ${el}.selectOption({ label: ${quote(value)} });`;
    }
    if (type === "check") return `${asyncPrefix}${el}.${step.checked === false ? (cs ? "UncheckAsync" : "uncheck") : (cs ? "CheckAsync" : "check")}()${suffix}`;
    if (type === "keydown") return `${asyncPrefix}${el}.${cs ? "PressAsync" : "press"}(${quote(step.key || "Enter")})${suffix}`;
  } else {
    const py = language === "Python";
    const java = language === "Java";
    const cs = language === "C#";
    const el = py ? `driver.find_element(By.CSS_SELECTOR, ${css})` : java ? `driver.findElement(By.cssSelector(${css}))`
      : cs ? `driver.FindElement(By.CssSelector(${css}))` : `driver.findElement(By.css(${css}))`;
    if (["click", "submit", "radio"].includes(type)) {
      const click = py ? `${el}.click()` : java ? `${el}.click();` : cs ? `${el}.Click();` : `await ${el}.click();`;
      return click;
    }
    if (type === "check") {
      const desired = step.checked !== false;
      if (step.target?.inputType === "radio") return py ? `${el}.click()` : java ? `${el}.click();` : cs ? `${el}.Click();` : `await ${el}.click();`;
      if (py) return `if ${el}.is_selected() != ${desired ? "True" : "False"}:\n        ${el}.click()`;
      if (java) return `if (${el}.isSelected() != ${desired}) ${el}.click();`;
      if (cs) return `if (${el}.Selected != ${desired}) ${el}.Click();`;
      return `if (await ${el}.isSelected() !== ${desired}) await ${el}.click();`;
    }
    if (["input", "change"].includes(type)) {
      return py ? `${el}.clear()\n    ${el}.send_keys(${quote(value)})` : java ? `${el}.clear();\n    ${el}.sendKeys(${quote(value)});`
        : cs ? `${el}.Clear();\n    ${el}.SendKeys(${quote(value)});` : `await ${el}.clear();\n    await ${el}.sendKeys(${quote(value)});`;
    }
    if (type === "select") {
      if (py) return `Select(${el}).select_by_visible_text(${quote(value)})`;
      if (java) return `new Select(${el}).selectByVisibleText(${quote(value)});`;
      if (cs) return `new SelectElement(${el}).SelectByText(${quote(value)});`;
      return gap(step, "Selenium JavaScript select helper is not provided.", language, gaps);
    }
    if (type === "keydown") return py ? `${el}.send_keys(${quote(step.key || "ENTER")})` : java ? `${el}.sendKeys(${quote(step.key || "ENTER")});`
      : cs ? `${el}.SendKeys(${quote(step.key || "ENTER")});` : `await ${el}.sendKeys(${quote(step.key || "ENTER")});`;
  }
  return gap(step, "action type is not supported by the local template.", language, gaps);
}

function robotLocatorVariables(testCases) {
  const locators = new Map();
  for (const testCase of testCases) {
    for (const step of testCase.steps || []) {
      const locator = locatorFor(step.target);
      if (locator && !locators.has(locator)) locators.set(locator, `LOCATOR_${String(locators.size + 1).padStart(2, "0")}`);
    }
  }
  return locators;
}

function makeScript({ framework, language, testCases, gaps }) {
  const robot = language.startsWith("Robot Framework");
  if (robot) {
    const locators = robotLocatorVariables(testCases);
    const variables = [...locators].map(([value, name]) => `\${${name}}    ${framework === "playwright" ? `css=${value}` : `css:${value}`}`);
    let lines = [];
    for (const testCase of testCases) {
      lines.push(`${testCase.id} - ${String(testCase.title).replace(/[\r\n]+/g, " ").slice(0, 120)}`);
      for (const step of testCase.steps || []) {
        const output = operation(step, framework, language, gaps);
        lines.push(output.replace(/\u0000([^\u0000]+)\u0000/g, (_match, raw) => `\${${locators.get(raw)}}`));
      }
      lines.push("");
    }
    const library = framework === "playwright" ? "Browser" : "SeleniumLibrary";
    return `*** Settings ***\nLibrary    ${library}\n\n*** Variables ***\n${variables.join("\n") || "# No captured locators"}\n\n*** Test Cases ***\n${lines.join("\n")}`;
  }

  const testBodies = testCases.map((testCase, index) => {
    const statements = (testCase.steps || []).map(step => operation(step, framework, language, gaps));
    const id = safeName(`${testCase.id}_${testCase.title}`);
    if (framework === "playwright" && language === "Python") return `def test_${id}(page: Page):\n${statements.map(line => `    ${line}`).join("\n") || "    pass"}\n`;
    if (framework === "playwright" && language === "Java") return `    @Test void test${index + 1}_${safeName(testCase.id)}() {\n        try (Playwright playwright = Playwright.create()) {\n            Browser browser = playwright.chromium().launch();\n            Page page = browser.newPage();\n${statements.map(line => `            ${line.trimStart()}`).join("\n")}\n            browser.close();\n        }\n    }`;
    if (framework === "playwright" && language === "C#") return `    [Test] public async Task Test${index + 1}_${safeName(testCase.id)}() {\n${statements.map(line => `        ${line}`).join("\n")}\n    }`;
    if (framework === "selenium" && language === "Python") return `def test_${id}(driver):\n${statements.map(line => `    ${line}`).join("\n") || "    pass"}\n`;
    if (framework === "selenium" && language === "Java") return `    @Test void test${index + 1}_${safeName(testCase.id)}() {\n        WebDriver driver = new ChromeDriver();\n        try {\n${statements.map(line => `            ${line.trimStart()}`).join("\n")}\n        } finally { driver.quit(); }\n    }`;
    if (framework === "selenium" && language === "C#") return `    [Test] public void Test${index + 1}_${safeName(testCase.id)}() {\n        using IWebDriver driver = new ChromeDriver();\n${statements.map(line => `        ${line.trimStart()}`).join("\n")}\n    }`;
    if (framework === "selenium") return `it(${quote(`${testCase.id} ${testCase.title}`)}, async () => {\n    const driver = await new Builder().forBrowser('chrome').build();\n    try {\n${statements.map(line => `        ${line.trimStart()}`).join("\n")}\n    } finally { await driver.quit(); }\n});`;
    const async = framework === "playwright" || language === "JavaScript";
    const driver = framework === "selenium";
    return `${driver ? "it" : "test"}(${quote(`${testCase.id} ${testCase.title}`)}, ${async ? "async " : ""}(${driver ? " " : "{page}"}) => {\n${statements.map(line => `    ${line.replace(/\bpage\b/g, driver ? "driver" : "page")}`).join("\n")}\n});`;
  });

  if (framework === "playwright" && language === "Python") return `import pytest\nfrom playwright.sync_api import Page\n\n${testBodies.join("\n")}`;
  if (framework === "playwright" && language === "Java") return `import com.microsoft.playwright.*;\nimport com.microsoft.playwright.options.SelectOption;\nimport org.junit.jupiter.api.Test;\n\nclass LedgeTest {\n${testBodies.join("\n\n")}\n}`;
  if (framework === "playwright" && language === "C#") return `using Microsoft.Playwright;\nusing NUnit.Framework;\nusing System.Threading.Tasks;\n\n[TestFixture] class LedgeTests {\n    IPlaywright playwright;\n    IBrowser browser;\n    IPage page;\n    [SetUp] public async Task SetUp() { playwright = await Playwright.CreateAsync(); browser = await playwright.Chromium.LaunchAsync(); page = await browser.NewPageAsync(); }\n    [TearDown] public async Task TearDown() { await browser.CloseAsync(); playwright.Dispose(); }\n${testBodies.join("\n\n")}\n}`;
  if (framework === "playwright") return `${language === "TypeScript" ? "import { test, expect } from '@playwright/test';" : "const { test, expect } = require('@playwright/test');"}\n\n${testBodies.join("\n\n")}`;
  if (language === "Python") return `import pytest\nfrom selenium import webdriver\nfrom selenium.webdriver.common.by import By\nfrom selenium.webdriver.support.ui import Select\n\n@pytest.fixture\ndef driver():\n    browser = webdriver.Chrome()\n    yield browser\n    browser.quit()\n\n${testBodies.join("\n")}`;
  if (language === "Java") return `import org.junit.jupiter.api.Test;\nimport org.openqa.selenium.*;\nimport org.openqa.selenium.chrome.ChromeDriver;\nimport org.openqa.selenium.support.ui.Select;\n\nclass LedgeTest {\n${testBodies.join("\n\n")}\n}`;
  if (language === "C#") return `using NUnit.Framework;\nusing OpenQA.Selenium;\nusing OpenQA.Selenium.Chrome;\nusing OpenQA.Selenium.Support.UI;\n\n[TestFixture] class LedgeTests {\n${testBodies.join("\n\n")}\n}`;
  return `const { Builder, By } = require('selenium-webdriver');\n\ndescribe('Ledge recorded tests', () => {\n${testBodies.map(body => body.split("\n").map(line => `    ${line}`).join("\n")).join("\n")}\n});`;
}

export function generateLocalAutomation({ framework, language, testCases }) {
  if (!OPTIONS[framework]?.some(([label]) => label === language)) throw new Error(`Unsupported framework/language combination: ${framework} + ${language}.`);
  if (!Array.isArray(testCases) || !testCases.length) throw new Error("Select at least one manual test case.");
  const gaps = [];
  const filename = OPTIONS[framework].find(([label]) => label === language)[1];
  const script = makeScript({ framework, language, testCases, gaps });
  if (new TextEncoder().encode(script).length > MAX_SCRIPT_BYTES) throw new Error("Generated script exceeds the safety limit. Select fewer test cases.");
  return { filename, framework, language, code: script, gaps, caseIds: testCases.map(item => String(item.id)), warnings: [],
    meta: { usedReference: false, generatedAt: new Date().toISOString() }, usage: null };
}
