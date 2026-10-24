import {
  HeadContent,
  Scripts,
  createRootRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { ThemeProvider } from "next-themes"

import appCss from "../styles.css?url"
import { getUser } from "@/lib/auth/session.functions"

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const user = await getUser()
    if (!user && location.pathname !== "/login") {
      throw redirect({
        to: "/login",
        search: { error: undefined },
        replace: true,
      })
    }
    if (user && location.pathname === "/login") {
      throw redirect({ to: "/", replace: true })
    }
    return { user }
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Sculpting DB",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const hideDevtools = useRouterState({
    select: (state) =>
      state.location.pathname === "/login" ||
      state.location.pathname.startsWith("/projects/"),
  })

  return (
    <html lang="en" className="geist geist-mono" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        {import.meta.env.DEV && !hideDevtools && (
          <TanStackDevtools
            config={{
              position: "bottom-right",
            }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        )}
        <Scripts />
      </body>
    </html>
  )
}
