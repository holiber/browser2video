// @ts-check

const { themes: prismThemes } = require("prism-react-renderer");

const owner =
  process.env.GITHUB_REPOSITORY_OWNER ||
  process.env.DOCUSAURUS_OWNER ||
  "alexonn";
const repo =
  (process.env.GITHUB_REPOSITORY || "").split("/")[1] ||
  process.env.DOCUSAURUS_REPO ||
  "browser2video";
const repoUrl = `https://github.com/${owner}/${repo}`;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Browser2Video",
  tagline: "Browser automation → video proofs",
  url: `https://${owner}.github.io`,
  baseUrl: `/${repo}/`,
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  favicon: "img/favicon.ico",

  organizationName: owner,
  projectName: repo,

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: require.resolve("./sidebars.ts"),
        },
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: "Browser2Video",
      items: [
        { to: "/docs/intro", label: "Docs", position: "left" },
        { href: repoUrl, label: "GitHub", position: "right" },
      ],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  },
};

module.exports = config;

