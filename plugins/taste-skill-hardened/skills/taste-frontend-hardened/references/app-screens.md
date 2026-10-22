# App screens

Follow the existing product's visual language. Prioritize legible data, clear
states, useful actions, and accurate status meanings over decorative variety.
Represent loading, empty, partial, error, unavailable, and complete states
distinctly. Never convert uncertain or partial totals into claims of completeness.

Use the optional assets/app.css only if it fits the host design system. Chart
helpers in assets/charts.js accept data as text and render SVG without external
dependencies. Keep labels, series names, and custom formatter output as text.
Do not replace text nodes with HTML interpolation when adapting the helpers.

Choose the representation around a question: a line for change, bars for a
comparison, a ranked list for ordering, a ring for one bounded share, and a table
when exact values matter. Include units, source/time period, and accessible labels.
Validate numbers before rendering. Use project tokens rather than introducing a
second design system. Real financial states must retain their exact meaning.
