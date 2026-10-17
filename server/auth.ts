import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseNoteWorkspace } from "../src/lib/notes.js";
import type { NoteWorkspace } from "../src/types/app.js";

const scryptAsync = promisify(scrypt);
const sessionCookieName = "notes_session";
const skillTokenPrefix = "notes_sk_v1";
const sessionDurationSeconds = 12 * 60 * 60;
const rememberedSessionDurationSeconds = 30 * 24 * 60 * 60;
const generatedPasswordAlphabet =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const runtimeSessionSecret = randomBytes(32).toString("base64url");
// 飞牛托管账号在设置应用密码前使用这个占位值，不参与密码校验。
const fnosOnlyPasswordHash = "fnos-login-only";

export type AuthRole = "user" | "superadmin";

export interface AuthUser {
  id: string;
  role: AuthRole;
  username: string;
}

export interface AccountSummary {
  createdAt: number;
  id: string;
  username: string;
}

export type AccountKind = "nas" | "app";

// 用户管理用的账号视图：区分飞牛托管账号与应用自建账号，并带上租户隔离所需的信息。
export interface ManagedAccount extends AccountSummary {
  disabled: boolean;
  hasPassword: boolean;
  kind: AccountKind;
  uid?: number;
}

export interface CreatedAccount extends AccountSummary {
  initialPassword: string;
}

export interface AuthenticatedAccount extends AccountSummary {
  disabled: boolean;
  passwordVersion: number;
  skillTokenVersion: number;
}

export interface ResetAccountPassword extends AccountSummary {
  temporaryPassword: string;
}

export interface StoredWorkspace {
  updatedAt: number;
  workspace: NoteWorkspace;
}

export interface WechatConfiguration {
  appId: string;
  appSecret: string;
  updatedAt: number;
}

export interface AnonymousQuotaStatus {
  dateKey: string;
  limit: number;
  remaining: number;
  resetsAt: string;
  used: number;
}

interface StoredAccount extends AccountSummary {
  disabled?: boolean;
  normalizedUsername: string;
  passwordHash: string;
  passwordSalt: string;
  passwordVersion: number;
  skillTokenVersion: number;
}

interface AuthDatabase {
  anonymousUploadQuota: {
    count: number;
    dateKey: string;
  };
  hermesInstallLinks: Record<string, string>;
  users: StoredAccount[];
  version: 1;
  wechatConfigurations: Record<string, WechatConfiguration>;
  workspaces: Record<string, StoredWorkspace>;
}

interface SessionPayload extends AuthUser {
  exp: number;
  passwordVersion?: number;
  remember?: boolean;
}

interface SkillTokenPayload extends AuthUser {
  credentialVersion?: string;
  passwordVersion?: number;
  skillTokenVersion: number;
}

export interface AuthSession extends AuthUser {
  passwordVersion?: number;
  remember: boolean;
}

export interface SkillTokenSession extends AuthSession {
  skillTokenVersion: number;
}

interface CookieOptions {
  remember: boolean;
  secure: boolean;
}

export class InvalidUsernameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUsernameError";
  }
}

export class DuplicateUsernameError extends Error {
  constructor() {
    super("该用户名或邮箱已经存在。");
    this.name = "DuplicateUsernameError";
  }
}

export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super("当前密码错误。");
    this.name = "InvalidCurrentPasswordError";
  }
}

export class InvalidNewPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidNewPasswordError";
  }
}

export class AccountNotFoundError extends Error {
  constructor() {
    super("普通用户不存在。");
    this.name = "AccountNotFoundError";
  }
}

export class WorkspaceConflictError extends Error {
  readonly updatedAt: number | null;

  constructor(updatedAt: number | null) {
    super("云端工作区已被其他客户端更新，请读取最新版本后重试。");
    this.name = "WorkspaceConflictError";
    this.updatedAt = updatedAt;
  }
}

export class AnonymousQuotaExceededError extends Error {
  readonly quota: AnonymousQuotaStatus;

  constructor(quota: AnonymousQuotaStatus) {
    super(
      `今日匿名图片额度（${quota.limit} 张）已用完，将于北京时间 0 点重置。请联系部署管理员注册账号。`,
    );
    this.name = "AnonymousQuotaExceededError";
    this.quota = quota;
  }
}

export class InvalidWechatConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWechatConfigurationError";
  }
}

function createEmptyDatabase(): AuthDatabase {
  return {
    anonymousUploadQuota: {
      count: 0,
      dateKey: "",
    },
    hermesInstallLinks: {},
    users: [],
    version: 1,
    wechatConfigurations: {},
    workspaces: {},
  };
}

export function validateWechatAppId(appId: string): string {
  const normalized = appId.trim();

  if (!/^wx[0-9a-f]{16}$/i.test(normalized)) {
    throw new InvalidWechatConfigurationError(
      "AppID 应为 wx 开头的 18 位公众号 AppID。",
    );
  }

  return normalized;
}

export function validateWechatAppSecret(appSecret: string): string {
  const normalized = appSecret.trim();

  if (!/^[0-9a-z]{32}$/i.test(normalized)) {
    throw new InvalidWechatConfigurationError(
      "AppSecret 应为 32 位字母或数字。",
    );
  }

  return normalized;
}

export function normalizeUsername(username: string): string {
  return username.trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
}

// 飞牛托管账号的 id 形如 nas-<uid>，用于在用户管理里区分两类租户。
export function accountKindOf(id: string): AccountKind {
  return /^nas-\d+$/.test(id) ? "nas" : "app";
}

function toManagedAccount(account: StoredAccount): ManagedAccount {
  const kind = accountKindOf(account.id);

  return {
    createdAt: account.createdAt,
    disabled: account.disabled === true,
    hasPassword: account.passwordHash !== fnosOnlyPasswordHash,
    id: account.id,
    kind,
    username: account.username,
    ...(kind === "nas" ? { uid: Number(account.id.slice(4)) } : {}),
  };
}

export function validateUsername(username: string): string {
  const normalizedDisplayName = username.trim().normalize("NFKC");
  const isUsername = /^[\p{L}\p{N}._-]{3,32}$/u.test(
    normalizedDisplayName,
  );
  const [emailLocalPart = "", emailDomain = "", ...extraEmailParts] =
    normalizedDisplayName.split("@");
  const isEmail =
    normalizedDisplayName.length <= 254 &&
    emailLocalPart.length > 0 &&
    emailLocalPart.length <= 64 &&
    extraEmailParts.length === 0 &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(emailLocalPart) &&
    /^(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/i.test(
      emailDomain,
    );

  if (!isUsername && !isEmail) {
    throw new InvalidUsernameError(
      "请输入有效邮箱，或 3–32 个字符的用户名（中英文、数字、点、下划线或连字符）。",
    );
  }

  return normalizedDisplayName;
}

function generateInitialPassword(length = 16): string {
  const bytes = randomBytes(length);

  return Array.from(
    bytes,
    (value) => generatedPasswordAlphabet[value % generatedPasswordAlphabet.length],
  ).join("");
}

function createHermesInstallTicket(ownerId: string): string {
  const encodedOwnerId = Buffer.from(ownerId, "utf8").toString("base64url");
  return `notes_hi_v1.${encodedOwnerId}.${randomBytes(32).toString("base64url")}`;
}

function readHermesInstallTicketOwner(ticket: string): string | null {
  const [prefix, encodedOwnerId, secret, extra] = ticket.split(".");

  if (
    prefix !== "notes_hi_v1" ||
    !encodedOwnerId ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret || "") ||
    extra
  ) {
    return null;
  }

  try {
    const ownerId = Buffer.from(encodedOwnerId, "base64url").toString("utf8");
    return ownerId &&
      Buffer.from(ownerId, "utf8").toString("base64url") === encodedOwnerId
      ? ownerId
      : null;
  } catch {
    return null;
  }
}

export function validateNewPassword(password: string): string {
  if (password.length < 8 || password.length > 128) {
    throw new InvalidNewPasswordError("新密码长度应为 8–128 个字符。");
  }

  return password;
}

async function hashPassword(
  password: string,
  salt = randomBytes(16).toString("base64url"),
): Promise<{ hash: string; salt: string }> {
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;

  return {
    hash: derivedKey.toString("base64url"),
    salt,
  };
}

async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  try {
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const expected = Buffer.from(expectedHash, "base64url");

    return (
      derivedKey.length === expected.length &&
      timingSafeEqual(derivedKey, expected)
    );
  } catch {
    return false;
  }
}

export function safeStringEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();

  return timingSafeEqual(leftHash, rightHash);
}

function parseStoredAccount(value: unknown): StoredAccount | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const account = value as Partial<StoredAccount>;
  if (
    typeof account.id === "string" &&
    Boolean(account.id) &&
    typeof account.username === "string" &&
    Boolean(account.username) &&
    typeof account.normalizedUsername === "string" &&
    Boolean(account.normalizedUsername) &&
    typeof account.passwordHash === "string" &&
    Boolean(account.passwordHash) &&
    typeof account.passwordSalt === "string" &&
    Boolean(account.passwordSalt) &&
    typeof account.createdAt === "number" &&
    Number.isFinite(account.createdAt)
  ) {
    return {
      createdAt: account.createdAt,
      disabled: account.disabled === true,
      id: account.id,
      normalizedUsername: account.normalizedUsername,
      passwordHash: account.passwordHash,
      passwordSalt: account.passwordSalt,
      passwordVersion:
        typeof account.passwordVersion === "number" &&
        Number.isInteger(account.passwordVersion) &&
        account.passwordVersion >= 1
          ? account.passwordVersion
          : 1,
      skillTokenVersion:
        typeof account.skillTokenVersion === "number" &&
        Number.isInteger(account.skillTokenVersion) &&
        account.skillTokenVersion >= 1
          ? account.skillTokenVersion
          : 1,
      username: account.username,
    };
  }

  return null;
}

function parseStoredWorkspace(value: unknown): StoredWorkspace | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const stored = value as Partial<StoredWorkspace>;
  const workspace = parseNoteWorkspace(JSON.stringify(stored.workspace));

  if (
    !workspace ||
    typeof stored.updatedAt !== "number" ||
    !Number.isFinite(stored.updatedAt)
  ) {
    return null;
  }

  return {
    updatedAt: stored.updatedAt,
    workspace,
  };
}

function parseWechatConfiguration(value: unknown): WechatConfiguration | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const configuration = value as Partial<WechatConfiguration>;

  if (
    typeof configuration.appId !== "string" ||
    typeof configuration.appSecret !== "string" ||
    typeof configuration.updatedAt !== "number" ||
    !Number.isFinite(configuration.updatedAt)
  ) {
    return null;
  }

  try {
    return {
      appId: validateWechatAppId(configuration.appId),
      appSecret: validateWechatAppSecret(configuration.appSecret),
      updatedAt: configuration.updatedAt,
    };
  } catch {
    return null;
  }
}

function parseDatabase(value: unknown): AuthDatabase {
  if (!value || typeof value !== "object") {
    return createEmptyDatabase();
  }

  const database = value as Partial<AuthDatabase>;
  const workspaces: Record<string, StoredWorkspace> = {};

  if (database.workspaces && typeof database.workspaces === "object") {
    for (const [userId, value] of Object.entries(database.workspaces)) {
      const workspace = parseStoredWorkspace(value);

      if (workspace) {
        workspaces[userId] = workspace;
      }
    }
  }

  const quota = database.anonymousUploadQuota;
  const hermesInstallLinks: Record<string, string> = {};
  const wechatConfigurations: Record<string, WechatConfiguration> = {};

  if (
    database.hermesInstallLinks &&
    typeof database.hermesInstallLinks === "object"
  ) {
    for (const [ownerId, ticket] of Object.entries(database.hermesInstallLinks)) {
      if (ownerId && typeof ticket === "string" && ticket) {
        hermesInstallLinks[ownerId] = ticket;
      }
    }
  }

  if (
    database.wechatConfigurations &&
    typeof database.wechatConfigurations === "object"
  ) {
    for (const [ownerId, value] of Object.entries(
      database.wechatConfigurations,
    )) {
      const configuration = parseWechatConfiguration(value);

      if (ownerId && configuration) {
        wechatConfigurations[ownerId] = configuration;
      }
    }
  }

  return {
    anonymousUploadQuota: {
      count:
        quota &&
        typeof quota.count === "number" &&
        Number.isFinite(quota.count) &&
        quota.count >= 0
          ? Math.floor(quota.count)
          : 0,
      dateKey:
        quota && typeof quota.dateKey === "string" ? quota.dateKey : "",
    },
    hermesInstallLinks,
    users: Array.isArray(database.users)
      ? database.users
          .map(parseStoredAccount)
          .filter((account): account is StoredAccount => account !== null)
      : [],
    version: 1,
    wechatConfigurations,
    workspaces,
  };
}

function getShanghaiDateParts(now: Date): {
  day: number;
  month: number;
  year: number;
} {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);

  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    year: shifted.getUTCFullYear(),
  };
}

export function getShanghaiDateKey(now = new Date()): string {
  const { day, month, year } = getShanghaiDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getNextShanghaiMidnight(now = new Date()): string {
  const { day, month, year } = getShanghaiDateParts(now);
  return new Date(
    Date.UTC(year, month - 1, day + 1) - 8 * 60 * 60 * 1000,
  ).toISOString();
}

export class NotesDataStore {
  readonly databasePath: string;
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.databasePath = path.join(dataDirectory, "notes-data.json");
  }

  private async readDatabase(): Promise<AuthDatabase> {
    try {
      return parseDatabase(
        JSON.parse(await fs.readFile(this.databasePath, "utf8")) as unknown,
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return createEmptyDatabase();
      }

      throw error;
    }
  }

  private async writeDatabase(database: AuthDatabase): Promise<void> {
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    const temporaryPath = `${this.databasePath}.${randomBytes(6).toString("hex")}.tmp`;

    try {
      await fs.writeFile(
        temporaryPath,
        `${JSON.stringify(database, null, 2)}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );
      await fs.rename(temporaryPath, this.databasePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async listUsers(): Promise<AccountSummary[]> {
    const database = await this.readDatabase();

    return database.users
      .map(({ createdAt, id, username }) => ({ createdAt, id, username }))
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  // 用户管理列表：飞牛托管账号用 nas-<uid>，应用自建账号用随机 id；
  // 两者都按账号 id 存放各自的工作区，天然是独立租户。
  async listManagedAccounts(): Promise<ManagedAccount[]> {
    const database = await this.readDatabase();

    return database.users
      .map((account) => toManagedAccount(account))
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "nas" ? -1 : 1;
        }

        return left.username.localeCompare(right.username, "zh-CN");
      });
  }

  async getManagedAccount(userId: string): Promise<ManagedAccount | null> {
    const account = (await this.readDatabase()).users.find(
      (candidate) => candidate.id === userId,
    );

    return account ? toManagedAccount(account) : null;
  }

  async ensureFnosUser(uid: number, username: string): Promise<AuthenticatedAccount> {
    return this.runExclusive(async () => {
      const database = await this.readDatabase();
      const id = `nas-${uid}`;
      let account = database.users.find((item) => item.id === id);
      // 用 NAS 用户名索引，NAS 账号才能在设置应用密码后用「用户名 + 密码」登录；
      // 名字已被其他应用账号占用时保留原样，该账号仍可用 NAS 身份登录。
      const normalizedUsername = normalizeUsername(username);
      const isNameTaken = database.users.some((item) => item.id !== id && item.normalizedUsername === normalizedUsername);
      if (!account) {
        account = { id, username, normalizedUsername: isNameTaken ? id : normalizedUsername, createdAt: Date.now(), passwordHash: fnosOnlyPasswordHash, passwordSalt: fnosOnlyPasswordHash, passwordVersion: 1, skillTokenVersion: 1 };
        database.users.push(account);
        await this.writeDatabase(database);
      } else if (account.username !== username || (!isNameTaken && account.normalizedUsername !== normalizedUsername)) {
        account.username = username;
        if (!isNameTaken) account.normalizedUsername = normalizedUsername;
        await this.writeDatabase(database);
      }
      return { id, username, createdAt: account.createdAt, disabled: Boolean(account.disabled), passwordVersion: account.passwordVersion, skillTokenVersion: account.skillTokenVersion };
    });
  }

  async createUser(username: string): Promise<CreatedAccount> {
    const created = await this.createAppAccount(username);
    return created;
  }

  // 应用自建账号：管理员直接指定用户名（可选密码，缺省生成一次性密码）。
  async createAppAccount(
    username: string,
    password?: string,
  ): Promise<CreatedAccount> {
    return this.runExclusive(async () => {
      const displayUsername = validateUsername(username);
      const normalizedUsername = normalizeUsername(displayUsername);
      const database = await this.readDatabase();

      if (
        database.users.some(
          (account) => account.normalizedUsername === normalizedUsername,
        )
      ) {
        throw new DuplicateUsernameError();
      }

      const initialPassword = password
        ? validateNewPassword(password)
        : generateInitialPassword();
      const hashed = await hashPassword(initialPassword);
      const account: StoredAccount = {
        createdAt: Date.now(),
        disabled: false,
        id: randomUUID(),
        normalizedUsername,
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
        passwordVersion: 1,
        skillTokenVersion: 1,
        username: displayUsername,
      };

      database.users.push(account);
      await this.writeDatabase(database);

      return {
        createdAt: account.createdAt,
        id: account.id,
        initialPassword,
        username: account.username,
      };
    });
  }

  // 停用同时把会话版本往前推：已签发的 Cookie 与 Skill Token 立即失效。
  async setAccountDisabled(
    userId: string,
    disabled: boolean,
  ): Promise<ManagedAccount> {
    return this.runExclusive(async () => {
      const database = await this.readDatabase();
      const account = database.users.find((candidate) => candidate.id === userId);

      if (!account) {
        throw new AccountNotFoundError();
      }

      account.disabled = disabled;

      if (disabled) {
        account.passwordVersion += 1;
        account.skillTokenVersion += 1;
        delete database.hermesInstallLinks[userId];
      }

      await this.writeDatabase(database);
      return toManagedAccount(account);
    });
  }

  // 删除账号连同它的工作区一起清掉，避免留下无主租户数据。
  async deleteAccount(userId: string): Promise<ManagedAccount> {
    return this.runExclusive(async () => {
      const database = await this.readDatabase();
      const account = database.users.find((candidate) => candidate.id === userId);

      if (!account) {
        throw new AccountNotFoundError();
      }

      database.users = database.users.filter(
        (candidate) => candidate.id !== userId,
      );
      delete database.workspaces[userId];
      delete database.wechatConfigurations[userId];
      delete database.hermesInstallLinks[userId];
      await this.writeDatabase(database);

      return toManagedAccount(account);
    });
  }

  async authenticateUser(
    username: string,
    password: string,
  ): Promise<AuthenticatedAccount | null> {
    const database = await this.readDatabase();
    const account = database.users.find(
      (candidate) =>
        candidate.normalizedUsername === normalizeUsername(username),
    );

    if (
      !account ||
      account.disabled === true ||
      (account.id.startsWith("nas-") && account.passwordHash === fnosOnlyPasswordHash) ||
      !(await verifyPassword(
        password,
        account.passwordSalt,
        account.passwordHash,
      ))
    ) {
      return null;
    }

    return {
      createdAt: account.createdAt,
      disabled: Boolean(account.disabled),
      id: account.id,
      passwordVersion: account.passwordVersion,
      skillTokenVersion: account.skillTokenVersion,
      username: account.username,
    };
  }

  async getUserById(userId: string): Promise<AuthenticatedAccount | null> {
    const database = await this.readDatabase();
    const account = database.users.find((candidate) => candidate.id === userId);

    return account
      ? {
          createdAt: account.createdAt,
          disabled: Boolean(account.disabled),
          id: account.id,
          passwordVersion: account.passwordVersion,
          skillTokenVersion: account.skillTokenVersion,
          username: account.username,
        }
      : null;
  }

  async getOrCreateHermesInstallLink(ownerId: string): Promise<string> {
    return this.runExclusive(async () => {
      const database = await this.readDatabase();
      const current = database.hermesInstallLinks[ownerId];

      if (current) {
        return current;
      }

      const ticket = createHermesInstallTicket(ownerId);
      database.hermesInstallLinks[ownerId] = ticket;
      await this.writeDatabase(database);
      return ticket;
    });
  }

  async resetHermesInstallLink(ownerId: string): Promise<string> {
    return this.runExclusive(async () => {
      const database = await this.readDatabase();
      const ticket = createHermesInstallTicket(ownerId);
      database.hermesInstallLinks[ownerId] = ticket;
      await this.writeDatabase(database);
      return ticket;
    });
  }

  async revokeHermesInstallLink(ownerId: string): Promise<void> {
    return this.runExclusive(async () => {
      const database = await this.readDatabase();

      if (!(ownerId in database.hermesInstallLinks)) {
        return;
      }

      delete database.hermesInstallLinks[ownerId];
      await this.writeDatabase(database);
    });
  }

  async getHermesInstallLinkOwner(ticket: string): Promise<string | null> {
    const ownerId = readHermesInstallTicketOwner(ticket);

    if (!ownerId) {
      return null;
    }

    const database = await this.readDatabase();
    const current = database.hermesInstallLinks[ownerId];
    return current && safeStringEqual(current, ticket) ? ownerId : null;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<number> {
    return this.writePassword(userId, newPassword, currentPassword);
  }

  // NAS 账号第一次设置应用密码：登录态已由飞牛网关校验，不要求当前密码。
  async setFnosAppPassword(userId: string, newPassword: string): Promise<number> {
    return this.writePassword(userId, newPassword);
  }

  // 管理员直接为账号设置新密码：跳过旧密码校验，但同样轮换会话与 Token 版本。
  async setAccountPasswordAsAdmin(userId: string, newPassword: string): Promise<number> {
    return this.runExclusive(async () => {
      const validatedPassword = validateNewPassword(newPassword);
      const database = await this.readDatabase();
      const account = database.users.find((candidate) => candidate.id === userId);

      if (!account) {
        throw new AccountNotFoundError();
      }

      if (
        await verifyPassword(
          validatedPassword,
          account.passwordSalt,
          account.passwordHash,
        )
      ) {
        throw new InvalidNewPasswordError("新密码不能与当前密码相同。");
      }

      const password = await hashPassword(validatedPassword);
      account.passwordHash = password.hash;
      account.passwordSalt = password.salt;
      account.passwordVersion += 1;
      account.skillTokenVersion += 1;
      delete database.hermesInstallLinks[userId];
      await this.writeDatabase(database);
      return account.passwordVersion;
    });
  }

  // 判断账号是否已经设置过应用密码；飞牛托管账号的占位值不算。
  async hasAppPassword(userId: string): Promise<boolean> {
    const account = (await this.readDatabase()).users.find(
      (candidate) => candidate.id === userId,
    );
    return Boolean(account && account.passwordHash !== fnosOnlyPasswordHash);
  }

  private async writePassword(
    userId: string,
    newPassword: string,
    currentPassword?: string,
  ): Promise<number> {
    return this.runExclusive(async () => {
      const validatedPassword = validateNewPassword(newPassword);
      const database = await this.readDatabase();
      const account = database.users.find((candidate) => candidate.id === userId);

      if (!account) {
        throw new AccountNotFoundError();
      }

      if (
        account.id.startsWith("nas-") &&
        account.passwordHash === fnosOnlyPasswordHash
      ) {
        const password = await hashPassword(validatedPassword);
        account.passwordHash = password.hash;
        account.passwordSalt = password.salt;
        account.passwordVersion += 1;
        account.skillTokenVersion += 1;
        await this.writeDatabase(database);
        return account.passwordVersion;
      }

      if (typeof currentPassword !== "string" || !currentPassword) {
        throw new InvalidCurrentPasswordError();
      }

      if (
        !(await verifyPassword(
          currentPassword,
          account.passwordSalt,
          account.passwordHash,
        ))
      ) {
        throw new InvalidCurrentPasswordError();
      }

      if (
        await verifyPassword(
          validatedPassword,
          account.passwordSalt,
          account.passwordHash,
        )
      ) {
        throw new InvalidNewPasswordError("新密码不能与当前密码相同。");
      }

      const password = await hashPassword(validatedPassword);
      account.passwordHash = password.hash;
      account.passwordSalt = password.salt;
      account.passwordVersion += 1;
      account.skillTokenVersion += 1;
      delete database.hermesInstallLinks[userId];
      await this.writeDatabase(database);
      return account.passwordVersion;
    });
  }

  async resetUserPassword(userId: string): Promise<ResetAccountPassword> {
    return this.runExclusive(async () => {
      const database = await this.readDatabase();
      const account = database.users.find((candidate) => candidate.id === userId);

      if (!account) {
        throw new AccountNotFoundError();
      }

      const temporaryPassword = generateInitialPassword();
      const password = await hashPassword(temporaryPassword);
      account.passwordHash = password.hash;
      account.passwordSalt = password.salt;
      account.passwordVersion += 1;
      account.skillTokenVersion += 1;
      delete database.hermesInstallLinks[userId];
      await this.writeDatabase(database);

      return {
        createdAt: account.createdAt,
        id: account.id,
        temporaryPassword,
        username: account.username,
      };
    });
  }

  async getWorkspace(userId: string): Promise<StoredWorkspace | null> {
    const database = await this.readDatabase();
    return database.workspaces[userId] ?? null;
  }

  async getWechatConfiguration(
    ownerId: string,
  ): Promise<WechatConfiguration | null> {
    const database = await this.readDatabase();
    return database.wechatConfigurations[ownerId] ?? null;
  }

  async saveWechatConfiguration(
    ownerId: string,
    appId: string,
    appSecret: string,
    now = Date.now(),
  ): Promise<WechatConfiguration> {
    return this.runExclusive(async () => {
      const database = await this.readDatabase();
      const configuration: WechatConfiguration = {
        appId: validateWechatAppId(appId),
        appSecret: validateWechatAppSecret(appSecret),
        updatedAt: Math.max(
          now,
          (database.wechatConfigurations[ownerId]?.updatedAt ?? 0) + 1,
        ),
      };

      database.wechatConfigurations[ownerId] = configuration;
      await this.writeDatabase(database);
      return configuration;
    });
  }

  async saveWorkspace(
    userId: string,
    value: unknown,
    now = Date.now(),
    expectedUpdatedAt?: number | null,
  ): Promise<StoredWorkspace> {
    return this.runExclusive(async () => {
      const workspace = parseNoteWorkspace(JSON.stringify(value));

      if (!workspace) {
        throw new Error("云端工作区数据格式无效。");
      }

      const database = await this.readDatabase();
      const currentUpdatedAt = database.workspaces[userId]?.updatedAt ?? null;

      if (
        expectedUpdatedAt !== undefined &&
        currentUpdatedAt !== expectedUpdatedAt
      ) {
        throw new WorkspaceConflictError(currentUpdatedAt);
      }

      const stored = {
        updatedAt: Math.max(now, (currentUpdatedAt ?? 0) + 1),
        workspace,
      };
      database.workspaces[userId] = stored;
      await this.writeDatabase(database);
      return stored;
    });
  }

  async reserveAnonymousUploads(
    amount: number,
    limit: number,
    now = new Date(),
  ): Promise<AnonymousQuotaStatus> {
    return this.runExclusive(async () => {
      const database = await this.readDatabase();
      const dateKey = getShanghaiDateKey(now);

      if (database.anonymousUploadQuota.dateKey !== dateKey) {
        database.anonymousUploadQuota = {
          count: 0,
          dateKey,
        };
      }

      const nextCount = database.anonymousUploadQuota.count + amount;
      const currentStatus: AnonymousQuotaStatus = {
        dateKey,
        limit,
        remaining: Math.max(0, limit - database.anonymousUploadQuota.count),
        resetsAt: getNextShanghaiMidnight(now),
        used: database.anonymousUploadQuota.count,
      };

      if (nextCount > limit) {
        throw new AnonymousQuotaExceededError(currentStatus);
      }

      database.anonymousUploadQuota.count = nextCount;
      await this.writeDatabase(database);

      return {
        ...currentStatus,
        remaining: Math.max(0, limit - nextCount),
        used: nextCount,
      };
    });
  }
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function getSessionSecret(): string {
  const configuredSecret = process.env.SESSION_SECRET?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  const adminUsername = process.env.SUPERADMIN?.trim() || "";
  const adminPassword = process.env.SUPERADMINPASSWORD?.trim() || "";

  if (adminUsername && adminPassword) {
    const fallbackSecret = [
      adminUsername,
      adminPassword,
      "smartisan-notes-session-v1",
    ].join(":");

    return createHash("sha256").update(fallbackSecret).digest("base64url");
  }

  return runtimeSessionSecret;
}

// 原生模式的写操作令牌必须跨进程重启保持稳定：它是从持久化的会话密钥派生出来的，
// 否则应用一升级/重启，页面里缓存的旧令牌就会让所有写请求报「写入校验失败」。
export function createNativeCsrfToken(uid: number): string {
  return createHmac("sha256", getSessionSecret())
    .update(`fnnotes-native-csrf:${uid}`)
    .digest("hex");
}

export function createSessionToken(
  user: AuthUser,
  remember: boolean,
  now = Date.now(),
  passwordVersion?: number,
): string {
  const duration = remember
    ? rememberedSessionDurationSeconds
    : sessionDurationSeconds;
  const payload: SessionPayload = {
    ...user,
    exp: Math.floor(now / 1000) + duration,
    passwordVersion,
    remember,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token: string | undefined,
  now = Date.now(),
): AuthSession | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, providedSignature, extra] = token.split(".");

  if (!encodedPayload || !providedSignature || extra) {
    return null;
  }

  const expectedSignature = createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");

  if (!safeStringEqual(providedSignature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;

    if (
      typeof payload.id !== "string" ||
      !payload.id ||
      typeof payload.username !== "string" ||
      !payload.username ||
      (payload.role !== "user" && payload.role !== "superadmin") ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(now / 1000)
    ) {
      return null;
    }

    return {
      id: payload.id,
      passwordVersion:
        typeof payload.passwordVersion === "number" &&
        Number.isInteger(payload.passwordVersion) &&
        payload.passwordVersion >= 1
          ? payload.passwordVersion
          : undefined,
      remember: payload.remember === true,
      role: payload.role,
      username: payload.username,
    };
  } catch {
    return null;
  }
}

function getSuperAdminSkillCredentialVersion(username: string): string | null {
  const adminUsername = process.env.SUPERADMIN?.trim();
  const adminPassword = process.env.SUPERADMINPASSWORD?.trim();

  if (
    !adminUsername ||
    !adminPassword ||
    normalizeUsername(username) !== normalizeUsername(adminUsername)
  ) {
    return null;
  }

  return createHmac("sha256", getSessionSecret())
    .update(
      [
        "smartisan-notes-skill-superadmin-v1",
        normalizeUsername(adminUsername),
        adminPassword,
      ].join(":"),
    )
    .digest("base64url");
}

export function createSkillToken(
  user: AuthUser,
  passwordVersion?: number,
  skillTokenVersion = 1,
): string {
  const payload: SkillTokenPayload = {
    id: user.id,
    role: user.role,
    skillTokenVersion,
    username: user.username,
    ...(user.role === "user"
      ? { passwordVersion }
      : {
          credentialVersion:
            getSuperAdminSkillCredentialVersion(user.username) ?? undefined,
        }),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", getSessionSecret())
    .update(`${skillTokenPrefix}.${encodedPayload}`)
    .digest("base64url");

  return `${skillTokenPrefix}.${encodedPayload}.${signature}`;
}

export function verifySkillToken(
  token: string | undefined,
): SkillTokenSession | null {
  if (!token) {
    return null;
  }

  const [prefix, encodedPayload, providedSignature, extra] = token.split(".");

  if (
    prefix !== skillTokenPrefix ||
    !encodedPayload ||
    !providedSignature ||
    extra
  ) {
    return null;
  }

  const expectedSignature = createHmac("sha256", getSessionSecret())
    .update(`${prefix}.${encodedPayload}`)
    .digest("base64url");

  if (!safeStringEqual(providedSignature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<SkillTokenPayload>;
    const validTokenVersion =
      typeof payload.skillTokenVersion === "number" &&
      Number.isInteger(payload.skillTokenVersion) &&
      payload.skillTokenVersion >= 1;

    if (
      typeof payload.id !== "string" ||
      !payload.id ||
      typeof payload.username !== "string" ||
      !payload.username ||
      (payload.role !== "user" && payload.role !== "superadmin") ||
      !validTokenVersion
    ) {
      return null;
    }

    if (payload.role === "superadmin") {
      const currentCredentialVersion = getSuperAdminSkillCredentialVersion(
        payload.username,
      );

      if (
        !currentCredentialVersion ||
        typeof payload.credentialVersion !== "string" ||
        !safeStringEqual(payload.credentialVersion, currentCredentialVersion)
      ) {
        return null;
      }
    } else if (
      typeof payload.passwordVersion !== "number" ||
      !Number.isInteger(payload.passwordVersion) ||
      payload.passwordVersion < 1
    ) {
      return null;
    }

    return {
      id: payload.id,
      passwordVersion: payload.passwordVersion,
      remember: false,
      role: payload.role,
      skillTokenVersion: payload.skillTokenVersion!,
      username: payload.username,
    };
  } catch {
    return null;
  }
}

export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();

    if (name === sessionCookieName) {
      try {
        return decodeURIComponent(cookie.slice(separatorIndex + 1).trim());
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

export function createSessionCookie(
  token: string,
  options: CookieOptions,
): string {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (options.remember) {
    parts.push(`Max-Age=${rememberedSessionDurationSeconds}`);
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function createExpiredSessionCookie(secure: boolean): string {
  return [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
