"use client";

import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Spinner } from "@/components/ui";

const SelfCheckIn = dynamic(() => import("@/components/SelfCheckIn"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center">
      <Spinner />
    </div>
  ),
});

function Inner() {
  const { slug } = useParams<{ slug: string }>();
  const sp = useSearchParams();
  return <SelfCheckIn slug={slug} k={sp.get("k")} p={sp.get("p")} />;
}

/** Public phone check-in: /checkin/<org>?k=<shared key>  or  /checkin/<org>?p=<personal token> */
export default function Page() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
