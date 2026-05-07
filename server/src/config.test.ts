import { describe, it, expect, afterEach } from "bun:test";
import {
  anyFeeActive,
  corsOrigins,
  creatorFeeActive,
  creatorFeeBps,
  demutualNetwork,
  isDevnet,
  platformFeeActive,
  platformFeeBps,
  platformFeeWallet,
  publicServiceInfo,
  serverPort
} from "./config";

describe("serverPort", () => {
  const saved = process.env.PORT;

  afterEach(() => {
    if (saved === undefined) delete process.env.PORT;
    else process.env.PORT = saved;
  });

  it("defaults to 3000 when unset or invalid", () => {
    delete process.env.PORT;
    expect(serverPort()).toBe(3000);
    process.env.PORT = "";
    expect(serverPort()).toBe(3000);
    process.env.PORT = "abc";
    expect(serverPort()).toBe(3000);
    process.env.PORT = "0";
    expect(serverPort()).toBe(3000);
    process.env.PORT = "70000";
    expect(serverPort()).toBe(3000);
  });

  it("uses PORT when valid", () => {
    process.env.PORT = "4000";
    expect(serverPort()).toBe(4000);
  });
});

describe("corsOrigins", () => {
  const saved = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (saved === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = saved;
  });

  it("returns regexes for localhost when CORS_ORIGINS unset", () => {
    delete process.env.CORS_ORIGINS;
    const o = corsOrigins();
    expect(o.length).toBeGreaterThan(0);
    expect(o[0]).toBeInstanceOf(RegExp);
  });

  it("parses comma-separated origins", () => {
    process.env.CORS_ORIGINS = "https://a.test, http://b.test ";
    expect(corsOrigins()).toEqual(["https://a.test", "http://b.test"]);
  });
});

describe("demutualNetwork / isDevnet", () => {
  const saved = process.env.DEMUTUAL_NETWORK;

  afterEach(() => {
    if (saved === undefined) delete process.env.DEMUTUAL_NETWORK;
    else process.env.DEMUTUAL_NETWORK = saved;
  });

  it("defaults to mainnet when unset or unknown", () => {
    delete process.env.DEMUTUAL_NETWORK;
    expect(demutualNetwork()).toBe("mainnet");
    expect(isDevnet()).toBe(false);
    process.env.DEMUTUAL_NETWORK = "testnet";
    expect(demutualNetwork()).toBe("mainnet");
  });

  it("returns devnet only when DEMUTUAL_NETWORK=devnet (case-insensitive)", () => {
    process.env.DEMUTUAL_NETWORK = "DEVNET";
    expect(demutualNetwork()).toBe("devnet");
    expect(isDevnet()).toBe(true);
  });

  it("publicServiceInfo reflects network and disables jupiter on devnet", () => {
    process.env.DEMUTUAL_NETWORK = "devnet";
    const info = publicServiceInfo();
    expect(info.network).toBe("devnet");
    expect(info.jupiterEnabled).toBe(false);
    expect(info.treasuryInvestEnabled).toBe(true);
    process.env.DEMUTUAL_NETWORK = "mainnet";
    const info2 = publicServiceInfo();
    expect(info2.jupiterEnabled).toBe(true);
    expect(info2.treasuryInvestEnabled).toBe(false);
    expect(info2.investTreasuryPubkey).toBeNull();
  });
});

describe("platform fee", () => {
  const savedBps = process.env.PLATFORM_FEE_BPS;
  const savedWallet = process.env.PLATFORM_FEE_WALLET_PUBKEY;

  afterEach(() => {
    if (savedBps === undefined) delete process.env.PLATFORM_FEE_BPS;
    else process.env.PLATFORM_FEE_BPS = savedBps;
    if (savedWallet === undefined) delete process.env.PLATFORM_FEE_WALLET_PUBKEY;
    else process.env.PLATFORM_FEE_WALLET_PUBKEY = savedWallet;
  });

  it("defaults to 0 / inactive when env unset", () => {
    delete process.env.PLATFORM_FEE_BPS;
    delete process.env.PLATFORM_FEE_WALLET_PUBKEY;
    expect(platformFeeBps()).toBe(0);
    expect(platformFeeWallet()).toBeNull();
    expect(platformFeeActive()).toBe(false);
  });

  it("clamps bps to [0, 1500] and floors fractions", () => {
    process.env.PLATFORM_FEE_BPS = "9999";
    expect(platformFeeBps()).toBe(1500);
    process.env.PLATFORM_FEE_BPS = "-5";
    expect(platformFeeBps()).toBe(0);
    process.env.PLATFORM_FEE_BPS = "12.7";
    expect(platformFeeBps()).toBe(12);
  });

  it("requires both BPS>0 and wallet to be active", () => {
    process.env.PLATFORM_FEE_BPS = "50";
    delete process.env.PLATFORM_FEE_WALLET_PUBKEY;
    expect(platformFeeActive()).toBe(false);
    process.env.PLATFORM_FEE_WALLET_PUBKEY = "FakeWallet1111111111111111111111111111111111";
    expect(platformFeeActive()).toBe(true);
    expect(publicServiceInfo().platformFeeWalletPubkey).toBe(
      "FakeWallet1111111111111111111111111111111111"
    );
    expect(publicServiceInfo().platformFeeBps).toBe(50);
  });
});

describe("creator fee", () => {
  const savedCreator = process.env.CREATOR_FEE_BPS;
  const savedPlat = process.env.PLATFORM_FEE_BPS;
  const savedWallet = process.env.PLATFORM_FEE_WALLET_PUBKEY;

  afterEach(() => {
    if (savedCreator === undefined) delete process.env.CREATOR_FEE_BPS;
    else process.env.CREATOR_FEE_BPS = savedCreator;
    if (savedPlat === undefined) delete process.env.PLATFORM_FEE_BPS;
    else process.env.PLATFORM_FEE_BPS = savedPlat;
    if (savedWallet === undefined) delete process.env.PLATFORM_FEE_WALLET_PUBKEY;
    else process.env.PLATFORM_FEE_WALLET_PUBKEY = savedWallet;
  });

  it("activates independently of platform fee (no wallet required)", () => {
    delete process.env.CREATOR_FEE_BPS;
    expect(creatorFeeActive()).toBe(false);
    process.env.CREATOR_FEE_BPS = "10";
    expect(creatorFeeBps()).toBe(10);
    expect(creatorFeeActive()).toBe(true);
  });

  it("anyFeeActive() is true when either fee is active", () => {
    delete process.env.PLATFORM_FEE_BPS;
    delete process.env.PLATFORM_FEE_WALLET_PUBKEY;
    delete process.env.CREATOR_FEE_BPS;
    expect(anyFeeActive()).toBe(false);
    process.env.CREATOR_FEE_BPS = "10";
    expect(anyFeeActive()).toBe(true);
  });

  it("publicServiceInfo exposes creatorFeeBps", () => {
    process.env.CREATOR_FEE_BPS = "10";
    expect(publicServiceInfo().creatorFeeBps).toBe(10);
  });
});
