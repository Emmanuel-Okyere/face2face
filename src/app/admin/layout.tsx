import { Suspense } from "react";
import AdminShell from "@/components/AdminShell";
import { Spinner } from "@/components/ui";

// Admin screens are all per-user and per-request: stream them behind a boundary
// so nothing request-specific (session, clock, search params) lands in the static shell.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminShell>
      <Suspense
        fallback={
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        }
      >
        {children}
      </Suspense>
    </AdminShell>
  );
}
