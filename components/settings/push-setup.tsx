"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/client/api";

function keyToBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "loading" | "unsupported" | "ios-install" | "no-server-key" | "denied" | "off" | "on";

export function PushSetup() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [serverKey, setServerKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
      if (ios && !standalone) return setState("ios-install");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      const info = await api.get<{ vapid_public_key: string | null }>("/api/push/subscribe").catch(() => null);
      if (!info?.vapid_public_key) return setState("no-server-key");
      setServerKey(info.vapid_public_key);
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(serverKey!) });
      await api.post("/api/push/subscribe", sub.toJSON());
      setState("on");
      toast.success("Notifications activées sur cet appareil");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Impossible d'activer les notifications sur cet appareil");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.del("/api/push/subscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    try {
      const r = await api.post<{ sent: number; devices: number }>("/api/push/test");
      toast.success(r.sent ? "Notification de test envoyée" : "Aucun appareil n'a accepté la notification");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'envoi");
    }
  };

  if (state === "loading") return <Spinner className="text-ink-3" />;
  if (state === "ios-install")
    return (
      <p className="flex items-start gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
        <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Sur iPhone, ajoute d&apos;abord MVMNT OS à l&apos;écran d&apos;accueil (Partager → Sur l&apos;écran d&apos;accueil), puis ouvre l&apos;app depuis son icône pour activer les notifications.
      </p>
    );
  if (state === "unsupported") return <p className="text-xs text-ink-3">Ce navigateur ne prend pas en charge les notifications push.</p>;
  if (state === "no-server-key") return <p className="text-xs text-ink-3">Les notifications push ne sont pas encore configurées sur le serveur (clés VAPID). Les rappels restent visibles dans l&apos;app.</p>;
  if (state === "denied") return <p className="text-xs text-ink-3">Les notifications sont bloquées pour ce site. Autorise-les dans les réglages du navigateur, puis recharge la page.</p>;
  return state === "on" ? (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={test}>
        <BellRing className="h-3.5 w-3.5" /> Envoyer un test
      </Button>
      <Button size="sm" variant="ghost" onClick={disable} disabled={busy}>
        Désactiver sur cet appareil
      </Button>
    </div>
  ) : (
    <Button size="sm" variant="primary" onClick={enable} disabled={busy}>
      {busy ? <Spinner className="h-3.5 w-3.5" /> : <BellRing className="h-3.5 w-3.5" />}
      Activer sur cet appareil
    </Button>
  );
}
