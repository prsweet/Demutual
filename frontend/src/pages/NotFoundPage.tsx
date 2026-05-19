import { useNavigate } from "react-router";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
      <p className="text-lg text-muted-foreground">Page not found</p>
      <button
        onClick={() => navigate("/")}
        className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
      >
        Go home
      </button>
    </div>
  );
}
