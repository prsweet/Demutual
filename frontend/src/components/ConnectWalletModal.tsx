import React, { useState } from "react";
import { Wallet, X, Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { fetchNonce, walletLogin } from "../lib/api";
import {
  connectBackpackWallet,
  connectPhantomWallet,
  getBackpackProvider,
  getPhantom,
  signLoginMessage
} from "../lib/wallet";

const USERNAME_REQUIRED = "WALLET_LOGIN_USERNAME_REQUIRED";

type Step = "select" | "username" | "processing";

export function ConnectWalletModal({
  isOpen,
  onClose
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { setSession } = useAuth();
  const [step, setStep] = useState<Step>("select");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    address: string;
    nonce: string;
    message: string;
    signature: string;
  } | null>(null);

  const reset = () => {
    setStep("select");
    setUsername("");
    setError(null);
    setPending(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!isOpen) return null;

  const runLogin = async (address: string, details: { nonce: string; message: string }, signature: string, name?: string) => {
    try {
      const token = await walletLogin({
        address,
        details,
        signature,
        username: name?.trim() || undefined
      });
      await setSession(token);
      handleClose();
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      if (code === USERNAME_REQUIRED) {
        setPending({ address, nonce: details.nonce, message: details.message, signature });
        setStep("username");
        setError(null);
        return;
      }
      setError(code === "INVALID_OR_EXPIRED_NONCE" ? "Session expired. Try again." : code);
      setStep("select");
    }
  };

  const onPhantom = async () => {
    setError(null);
    setStep("processing");
    try {
      const address = await connectPhantomWallet();
      const { nonce, message } = await fetchNonce(address);
      const phantom = getPhantom();
      if (!phantom?.signMessage) throw new Error("Phantom cannot sign messages.");
      const signature = await signLoginMessage(phantom, message);
      await runLogin(address, { nonce, message }, signature);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
      setStep("select");
    }
  };

  const onBackpack = async () => {
    setError(null);
    setStep("processing");
    try {
      const address = await connectBackpackWallet();
      const { nonce, message } = await fetchNonce(address);
      const bp = getBackpackProvider();
      if (!bp?.signMessage) throw new Error("Backpack cannot sign messages.");
      const signature = await signLoginMessage(bp, message);
      await runLogin(address, { nonce, message }, signature);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
      setStep("select");
    }
  };

  const onSubmitUsername = async () => {
    if (!pending || !username.trim()) return;
    setStep("processing");
    setError(null);
    try {
      const token = await walletLogin({
        address: pending.address,
        details: { nonce: pending.nonce, message: pending.message },
        signature: pending.signature,
        username: username.trim()
      });
      await setSession(token);
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setStep("username");
    }
  };

  const phantomInstalled = typeof window !== "undefined" && Boolean(getPhantom());
  const backpackInstalled = typeof window !== "undefined" && Boolean(getBackpackProvider());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm tracking-tight p-4">
      <div
        className="w-full max-w-sm bg-[#f8f9f7] rounded-3xl p-6 shadow-[inset_0_2px_1px_rgba(255,255,255,0.8),0_24px_48px_-12px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.05)] relative overflow-hidden"
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-black/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-[12px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 text-[13px] font-medium text-red-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {step === "select" && (
          <div className="flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="w-12 h-12 bg-black/5 rounded-[14px] flex items-center justify-center mb-4 shadow-[inset_0_1px_0_white]">
              <Wallet className="w-6 h-6 text-[#1a1c1e]" />
            </div>
            <h2 className="text-[20px] font-semibold text-[#1a1c1e] mb-1">Connect Wallet</h2>
            <p className="text-[14px] text-[#6b7280] mb-6">Sign in with your Solana wallet (same message the API expects for JWT).</p>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={!phantomInstalled}
                onClick={() => void onPhantom()}
                className="flex items-center gap-3 w-full p-4 bg-white rounded-[12px] border border-black/5 shadow-sm hover:shadow-md transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-8 h-8 rounded-full bg-[#ab9ff2] flex items-center justify-center text-white font-semibold text-xs">
                  P
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-[#1a1c1e] group-hover:text-[#ab9ff2] transition-colors">Phantom</h3>
                  <p className="text-[13px] text-[#6b7280]">
                    {phantomInstalled ? "Sign message to log in" : "Not detected — install Phantom"}
                  </p>
                </div>
              </button>

              <button
                type="button"
                disabled={!backpackInstalled}
                onClick={() => void onBackpack()}
                className="flex items-center gap-3 w-full p-4 bg-white rounded-[12px] border border-black/5 shadow-sm hover:shadow-md transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-8 h-8 rounded-full bg-[#e36414] flex items-center justify-center text-white font-semibold text-xs">
                  B
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-[#1a1c1e] group-hover:text-[#e36414] transition-colors">Backpack</h3>
                  <p className="text-[13px] text-[#6b7280]">
                    {backpackInstalled ? "Sign message to log in" : "Not detected — install Backpack"}
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}

        {step === "username" && (
          <div className="flex flex-col animate-in slide-in-from-right-4 duration-300">
            <h2 className="text-[20px] font-semibold text-[#1a1c1e] mb-1">Choose a display name</h2>
            <p className="text-[14px] text-[#6b7280] mb-6">First time with this wallet — pick a username for your profile.</p>

            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-black/10 rounded-[12px] text-[15px] font-medium text-[#1a1c1e] focus:outline-none focus:ring-2 focus:ring-black/5 shadow-sm mb-6 placeholder:text-gray-400"
              autoFocus
              maxLength={48}
            />

            <button
              type="button"
              onClick={() => void onSubmitUsername()}
              disabled={!username.trim()}
              className="w-full py-3 bg-[#1a1c1e] text-white rounded-[12px] text-[15px] font-semibold shadow-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#374151] transition-all"
            >
              Complete sign up
            </button>
          </div>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-8 animate-in fade-in duration-300">
            <Loader2 className="w-8 h-8 text-[#1a1c1e] animate-spin mb-4" />
            <h2 className="text-[18px] font-semibold text-[#1a1c1e]">Working with wallet…</h2>
            <p className="text-[14px] text-[#6b7280] text-center mt-2">
              Approve the connection or signature in your wallet when prompted.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
