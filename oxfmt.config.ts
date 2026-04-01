import { defineConfig } from "oxfmt";

export default defineConfig({
  exclude: ["dist", "web/dist", "node_modules", "fixtures"],
  sortTailwindcss: true,
  sortImports: {
    customGroups: [
      {
        groupName: "project",
        elementNamePattern: ["#server/**", "#web/**"],
      },
    ],
    groups: ["type-import", "value-builtin", "value-external", "project", "value-internal"],
    newlinesBetween: true,
  },
});
