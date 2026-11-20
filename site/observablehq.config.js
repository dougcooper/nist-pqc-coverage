const base = process.env.SITE_BASE ?? "/";

export default {
  title: "NIST PQC coverage",
  description:
    "Post-quantum CAVP and CMVP validations, operating environments, and coverage analysis",
  root: "docs",
  base,
  style: "style.css",
  preserveExtension: true,
  pager: false,
  footer:
    "Source: NIST CSRC CAVP and CMVP. OS/CPU fields are heuristic normalizations; in-process matches are inferred.",
  pages: [
    {name: "Overview", path: "/"},
    {name: "Operating environments", path: "/environments"},
    {name: "Coverage", path: "/coverage"},
    {name: "Pipeline", path: "/pipeline"},
    {name: "Tested configurations", path: "/policies"},
    {name: "SQL console", path: "/sql"},
    {name: "Explorer", path: "/explorer"},
  ],
};
