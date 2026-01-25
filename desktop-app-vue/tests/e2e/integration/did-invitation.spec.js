/**
 * DID邀请机制 E2E测试
 * 使用 Playwright 进行端到端测试
 */

const { test, expect } = require("@playwright/test");

test.describe("DID邀请完整流程", () => {
  test.beforeEach(async ({ page }) => {
    // 清理测试数据
    await page.goto("http://localhost:5173");
    // 假设有清理测试数据的API
    await page.evaluate(() => window.ipc?.invoke("test:clear-data"));
  });

  test("管理员发送DID邀请", async ({ page }) => {
    // 1. 登录为Alice
    await page.goto("http://localhost:5173/login");
    await page.fill('[data-testid="did-input"]', "did:chainlesschain:alice");
    await page.click('[data-testid="login-button"]');

    // 等待登录成功
    await expect(page.locator('[data-testid="user-profile"]')).toBeVisible();

    // 2. 创建组织
    await page.click('[data-testid="identity-switcher"]');
    await page.click("text=创建新组织");

    await page.fill('[data-testid="org-name"]', "Alice Team");
    await page.selectOption('[data-testid="org-type"]', "startup");
    await page.fill('[data-testid="org-description"]', "我们的测试团队");
    await page.click('button:has-text("创建")');

    // 等待组织创建成功
    await expect(page.locator(".ant-message-success")).toContainText(
      "组织创建成功",
    );

    // 3. 进入成员管理页面
    await page.click('[data-testid="org-members-menu"]');
    await expect(page).toHaveURL(/\/organization\/members/);

    // 4. 创建DID邀请
    await page.click('button:has-text("邀请成员")');

    // 选择DID邀请方式
    await page.click('input[value="did"]');

    // 输入Bob的DID
    await page.fill(
      '[placeholder="did:chainlesschain:..."]',
      "did:chainlesschain:bob",
    );

    // 选择角色
    await page.selectOption('select[name="role"]', "member");

    // 添加消息
    await page.fill(
      '[data-testid="invitation-message"]',
      "欢迎加入Alice Team！",
    );

    // 提交邀请
    await page.click('button:has-text("创建邀请")');

    // 验证成功消息
    await expect(page.locator(".ant-message-success")).toContainText(
      "DID邀请已发送",
    );

    // 验证显示了邀请信息
    await expect(page.locator(".generated-invitation")).toBeVisible();
    await expect(page.locator(".generated-invitation")).toContainText(
      "did:chainlesschain:bob",
    );
  });

  test("用户接受DID邀请", async ({ browser }) => {
    // 使用两个浏览器上下文模拟两个用户

    // Alice的上下文
    const aliceContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();

    // Bob的上下文
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();

    // 1. Alice登录并创建组织
    await alicePage.goto("http://localhost:5173/login");
    await alicePage.fill(
      '[data-testid="did-input"]',
      "did:chainlesschain:alice",
    );
    await alicePage.click('[data-testid="login-button"]');

    await alicePage.click('[data-testid="identity-switcher"]');
    await alicePage.click("text=创建新组织");
    await alicePage.fill('[data-testid="org-name"]', "Alice Team");
    await alicePage.click('button:has-text("创建")');

    // 2. Alice邀请Bob
    await alicePage.click('[data-testid="org-members-menu"]');
    await alicePage.click('button:has-text("邀请成员")');
    await alicePage.click('input[value="did"]');
    await alicePage.fill(
      '[placeholder="did:chainlesschain:..."]',
      "did:chainlesschain:bob",
    );
    await alicePage.click('button:has-text("创建邀请")');

    await expect(alicePage.locator(".ant-message-success")).toBeVisible();

    // 3. Bob登录
    await bobPage.goto("http://localhost:5173/login");
    await bobPage.fill('[data-testid="did-input"]', "did:chainlesschain:bob");
    await bobPage.click('[data-testid="login-button"]');

    // 4. Bob应该看到邀请通知
    await expect(
      bobPage.locator('[data-testid="invitation-bell"] .ant-badge-count'),
    ).toContainText("1");

    // 5. Bob打开邀请列表
    await bobPage.click('[data-testid="invitation-bell"]');

    // 验证抽屉打开
    await expect(bobPage.locator(".ant-drawer-content")).toBeVisible();

    // 验证邀请卡片存在
    await expect(bobPage.locator(".invitation-card")).toBeVisible();
    await expect(bobPage.locator(".invitation-card")).toContainText(
      "Alice Team",
    );
    await expect(bobPage.locator(".invitation-card")).toContainText("Alice");

    // 6. Bob接受邀请
    await bobPage.click('button:has-text("接受邀请")');

    // 验证成功消息
    await expect(bobPage.locator(".ant-message-success")).toContainText(
      "成功加入组织",
    );

    // 7. 验证邀请从列表中消失
    await expect(bobPage.locator(".invitation-card")).not.toBeVisible();
    await expect(
      bobPage.locator('[data-testid="invitation-bell"] .ant-badge-count'),
    ).not.toBeVisible();

    // 8. 验证Bob可以看到新组织
    await bobPage.click('[data-testid="identity-switcher"]');
    await expect(bobPage.locator("text=Alice Team")).toBeVisible();

    // 9. 切换到Alice Team身份
    await bobPage.click("text=Alice Team");

    // 验证切换成功
    await expect(bobPage.locator(".current-identity")).toContainText(
      "Alice Team",
    );

    // 清理
    await aliceContext.close();
    await bobContext.close();
  });

  test("用户拒绝DID邀请", async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();

    // 1. Alice创建组织并邀请Bob
    await alicePage.goto("http://localhost:5173/login");
    await alicePage.fill(
      '[data-testid="did-input"]',
      "did:chainlesschain:alice",
    );
    await alicePage.click('[data-testid="login-button"]');

    await alicePage.click('[data-testid="identity-switcher"]');
    await alicePage.click("text=创建新组织");
    await alicePage.fill('[data-testid="org-name"]', "Alice Team");
    await alicePage.click('button:has-text("创建")');

    await alicePage.click('[data-testid="org-members-menu"]');
    await alicePage.click('button:has-text("邀请成员")');
    await alicePage.click('input[value="did"]');
    await alicePage.fill(
      '[placeholder="did:chainlesschain:..."]',
      "did:chainlesschain:bob",
    );
    await alicePage.click('button:has-text("创建邀请")');

    // 2. Bob登录
    await bobPage.goto("http://localhost:5173/login");
    await bobPage.fill('[data-testid="did-input"]', "did:chainlesschain:bob");
    await bobPage.click('[data-testid="login-button"]');

    // 3. Bob打开邀请列表
    await bobPage.click('[data-testid="invitation-bell"]');

    // 4. Bob拒绝邀请
    await bobPage.click('button:has-text("拒绝")');

    // 验证提示消息
    await expect(bobPage.locator(".ant-message")).toContainText("已拒绝");

    // 5. 验证邀请从列表中消失
    await expect(bobPage.locator(".invitation-card")).not.toBeVisible();

    // 6. 验证Bob的组织列表中没有Alice Team
    await bobPage.click('[data-testid="identity-switcher"]');
    await expect(bobPage.locator("text=Alice Team")).not.toBeVisible();

    await aliceContext.close();
    await bobContext.close();
  });

  test("DID格式验证", async ({ page }) => {
    await page.goto("http://localhost:5173/login");
    await page.fill('[data-testid="did-input"]', "did:chainlesschain:alice");
    await page.click('[data-testid="login-button"]');

    // 创建组织
    await page.click('[data-testid="identity-switcher"]');
    await page.click("text=创建新组织");
    await page.fill('[data-testid="org-name"]', "Test Org");
    await page.click('button:has-text("创建")');

    // 打开邀请对话框
    await page.click('[data-testid="org-members-menu"]');
    await page.click('button:has-text("邀请成员")');
    await page.click('input[value="did"]');

    // 测试无效DID
    const invalidDIDs = [
      "not-a-did",
      "did:",
      "did:chainlesschain",
      "random-string",
    ];

    for (const invalidDID of invalidDIDs) {
      await page.fill('[placeholder="did:chainlesschain:..."]', invalidDID);
      await page.click('[data-testid="invitation-message"]'); // Trigger blur

      // 应该显示错误消息
      await expect(page.locator(".error-message")).toBeVisible();
      await expect(page.locator(".error-message")).toContainText("DID格式错误");
    }

    // 测试有效DID
    await page.fill(
      '[placeholder="did:chainlesschain:..."]',
      "did:chainlesschain:bob",
    );
    await page.click('[data-testid="invitation-message"]');

    // 错误消息应该消失
    await expect(page.locator(".error-message")).not.toBeVisible();
  });

  test("邀请过期处理", async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();

    // 1. Alice创建组织
    await alicePage.goto("http://localhost:5173/login");
    await alicePage.fill(
      '[data-testid="did-input"]',
      "did:chainlesschain:alice",
    );
    await alicePage.click('[data-testid="login-button"]');

    await alicePage.click('[data-testid="identity-switcher"]');
    await alicePage.click("text=创建新组织");
    await alicePage.fill('[data-testid="org-name"]', "Alice Team");
    await alicePage.click('button:has-text("创建")');

    // 2. 创建一个即将过期的邀请（1小时）
    await alicePage.click('[data-testid="org-members-menu"]');
    await alicePage.click('button:has-text("邀请成员")');
    await alicePage.click('input[value="did"]');
    await alicePage.fill(
      '[placeholder="did:chainlesschain:..."]',
      "did:chainlesschain:bob",
    );
    await alicePage.selectOption('select[name="expireOption"]', "1h");
    await alicePage.click('button:has-text("创建邀请")');

    // 3. Bob登录查看邀请
    await bobPage.goto("http://localhost:5173/login");
    await bobPage.fill('[data-testid="did-input"]', "did:chainlesschain:bob");
    await bobPage.click('[data-testid="login-button"]');

    await bobPage.click('[data-testid="invitation-bell"]');

    // 4. 验证显示过期时间
    await expect(bobPage.locator(".expire-warning")).toBeVisible();
    await expect(bobPage.locator(".expire-warning")).toContainText("到期");

    // 5. 手动设置邀请为已过期（通过调试API）
    await bobPage.evaluate(() => {
      return window.ipc?.invoke("test:expire-invitation", "invitation-id");
    });

    // 6. 刷新邀请列表
    await bobPage.reload();
    await bobPage.click('[data-testid="invitation-bell"]');

    // 7. 过期的邀请应该不显示
    await expect(bobPage.locator(".invitation-card")).not.toBeVisible();
    await expect(bobPage.locator("text=暂无待处理的邀请")).toBeVisible();

    await aliceContext.close();
    await bobContext.close();
  });

  test("多个邀请管理", async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();

    // Alice和另一个组织管理员Charlie都邀请Bob
    const charlieContext = await browser.newContext();
    const charliePage = await charlieContext.newPage();

    // 1. Alice创建组织并邀请Bob
    await alicePage.goto("http://localhost:5173/login");
    await alicePage.fill(
      '[data-testid="did-input"]',
      "did:chainlesschain:alice",
    );
    await alicePage.click('[data-testid="login-button"]');

    await alicePage.click('[data-testid="identity-switcher"]');
    await alicePage.click("text=创建新组织");
    await alicePage.fill('[data-testid="org-name"]', "Alice Team");
    await alicePage.click('button:has-text("创建")');

    await alicePage.click('[data-testid="org-members-menu"]');
    await alicePage.click('button:has-text("邀请成员")');
    await alicePage.click('input[value="did"]');
    await alicePage.fill(
      '[placeholder="did:chainlesschain:..."]',
      "did:chainlesschain:bob",
    );
    await alicePage.click('button:has-text("创建邀请")');

    // 2. Charlie创建组织并邀请Bob
    await charliePage.goto("http://localhost:5173/login");
    await charliePage.fill(
      '[data-testid="did-input"]',
      "did:chainlesschain:charlie",
    );
    await charliePage.click('[data-testid="login-button"]');

    await charliePage.click('[data-testid="identity-switcher"]');
    await charliePage.click("text=创建新组织");
    await charliePage.fill('[data-testid="org-name"]', "Charlie Corp");
    await charliePage.click('button:has-text("创建")');

    await charliePage.click('[data-testid="org-members-menu"]');
    await charliePage.click('button:has-text("邀请成员")');
    await charliePage.click('input[value="did"]');
    await charliePage.fill(
      '[placeholder="did:chainlesschain:..."]',
      "did:chainlesschain:bob",
    );
    await charliePage.click('button:has-text("创建邀请")');

    // 3. Bob登录
    await bobPage.goto("http://localhost:5173/login");
    await bobPage.fill('[data-testid="did-input"]', "did:chainlesschain:bob");
    await bobPage.click('[data-testid="login-button"]');

    // 4. Bob应该看到2个邀请
    await expect(
      bobPage.locator('[data-testid="invitation-bell"] .ant-badge-count'),
    ).toContainText("2");

    await bobPage.click('[data-testid="invitation-bell"]');

    // 验证有2个邀请卡片
    const invitations = bobPage.locator(".invitation-card");
    await expect(invitations).toHaveCount(2);

    // 5. Bob接受第一个（Alice Team）
    await bobPage
      .locator(
        '.invitation-card:has-text("Alice Team") button:has-text("接受邀请")',
      )
      .click();
    await expect(bobPage.locator(".ant-message-success")).toBeVisible();

    // 6. 验证还剩1个邀请
    await expect(
      bobPage.locator('[data-testid="invitation-bell"] .ant-badge-count'),
    ).toContainText("1");
    await expect(invitations).toHaveCount(1);

    // 7. Bob拒绝第二个（Charlie Corp）
    await bobPage
      .locator(
        '.invitation-card:has-text("Charlie Corp") button:has-text("拒绝")',
      )
      .click();

    // 8. 验证所有邀请都处理完了
    await expect(
      bobPage.locator('[data-testid="invitation-bell"] .ant-badge-count'),
    ).not.toBeVisible();
    await expect(bobPage.locator("text=暂无待处理的邀请")).toBeVisible();

    await aliceContext.close();
    await charlieContext.close();
    await bobContext.close();
  });
});

test.describe("权限测试", () => {
  test("只有Owner和Admin可以邀请", async ({ page }) => {
    // 1. Alice创建组织
    await page.goto("http://localhost:5173/login");
    await page.fill('[data-testid="did-input"]', "did:chainlesschain:alice");
    await page.click('[data-testid="login-button"]');

    await page.click('[data-testid="identity-switcher"]');
    await page.click("text=创建新组织");
    await page.fill('[data-testid="org-name"]', "Alice Team");
    await page.click('button:has-text("创建")');

    // 2. Alice邀请Bob为Viewer
    await page.click('[data-testid="org-members-menu"]');
    await page.click('button:has-text("邀请成员")');
    await page.click('input[value="did"]');
    await page.fill(
      '[placeholder="did:chainlesschain:..."]',
      "did:chainlesschain:bob",
    );
    await page.selectOption('select[name="role"]', "viewer");
    await page.click('button:has-text("创建邀请")');

    // 3. 登出并以Bob身份登录
    await page.click('[data-testid="user-menu"]');
    await page.click("text=退出登录");

    await page.fill('[data-testid="did-input"]', "did:chainlesschain:bob");
    await page.click('[data-testid="login-button"]');

    // 4. Bob接受邀请
    await page.click('[data-testid="invitation-bell"]');
    await page.click('button:has-text("接受邀请")');

    // 5. 切换到Alice Team
    await page.click('[data-testid="identity-switcher"]');
    await page.click("text=Alice Team");

    // 6. Bob作为Viewer，应该看不到"邀请成员"按钮
    await page.click('[data-testid="org-members-menu"]');
    await expect(page.locator('button:has-text("邀请成员")')).not.toBeVisible();
  });
});
