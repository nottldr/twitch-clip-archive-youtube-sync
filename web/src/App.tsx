import { RouterProvider } from "@tanstack/react-router";

import { SSEProvider } from "#web/lib/sse-context.js";
import { ToastProvider } from "#web/lib/toast.js";
import { router } from "#web/router.js";

export function App() {
  return (
    <ToastProvider>
      <SSEProvider>
        <RouterProvider router={router} />
      </SSEProvider>
    </ToastProvider>
  );
}
