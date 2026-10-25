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
import { createIsomorphicFn } from "@tanstack/react-start"

import appCss from "../styles.css?url"
import { getUser } from "@/lib/auth/session.functions"

const getSiteOrigin = createIsomorphicFn()
  .server(() => new URL(process.env.BETTER_AUTH_URL!).origin)
  .client(() => window.location.origin)

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const user = await getUser()
    if (!user && location.pathname !== "/" && location.pathname !== "/login") {
      if (location.pathname === "/mcp/consent")
        throw redirect({
          href: `/?${new URLSearchParams(location.searchStr).get("oauth_query") ?? location.searchStr.slice(1)}`,
        })
      throw redirect({
        to: "/",
        search: { error: undefined, sig: undefined },
        replace: true,
      })
    }
    return { user }
  },
  head: () => {
    const origin = getSiteOrigin()
    const image = new URL("/ogimage.png", origin).href
    const description =
      "Design entities and relationships on a simple canvas. Sketch by hand or connect your AI with Sculpting DB."
    const imageAlt =
      "Sculpting DB — Shape your data. Then build. A database diagram and the OnionRings mascot."

    return {
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
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Sculpting DB" },
        { property: "og:title", content: "Sculpting DB" },
        { property: "og:description", content: description },
        { property: "og:url", content: new URL("/", origin).href },
        { property: "og:image", content: image },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: imageAlt },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "Sculpting DB" },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: image },
        { name: "twitter:image:alt", content: imageAlt },
      ],
      links: [
        {
          rel: "icon",
          type: "image/x-icon",
          sizes: "16x16 24x24 32x32 64x64",
          href: "/favicon.ico",
        },
        {
          rel: "icon",
          type: "image/svg+xml",
          sizes: "any",
          href: "/favicon.svg",
        },
        {
          rel: "stylesheet",
          href: appCss,
        },
      ],
    }
  },
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const { user } = Route.useRouteContext()
  const hideDevtools = useRouterState({
    select: (state) =>
      state.location.pathname === "/login" ||
      state.location.pathname.startsWith("/mcp/") ||
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
        {import.meta.env.DEV && user && !hideDevtools && (
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
