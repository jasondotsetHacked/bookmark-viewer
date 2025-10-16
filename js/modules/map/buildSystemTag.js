import { loadSystemsData } from '../../loadSystemsData.js';

const classColors = {
    "HS": "#2FEFEF",
    "LS": "#EFEF00",
    "NS": "#D6469D",
    "C1": "#00AAFF",
    "C2": "#2FEFEF",
    "C3": "#79F258",
    "C4": "#FFF200",
    "C5": "#FF7F27",
    "C6": "#ED1C24",
    "THERA": "#FFFFFF",
    "C13": "#7F7F7F",
    "PV": "#FF9800"
};

export async function buildSystemTag(selection) {
    const systemsData = await loadSystemsData();

    selection.each(function(d) {
        const g = d3.select(this);
        const lookupKey = d.name;
        const fallbackKey = d.filterKey || d.originSystem;
        const systemInfo = systemsData[lookupKey] || (fallbackKey ? systemsData[fallbackKey] : undefined);
        let wormholeClass = null;
        let classColor = null;

        if (d.isPlaceholder && d.wormholeClass) {
            wormholeClass = (d.wormholeClass || '').toUpperCase();
            classColor = classColors[wormholeClass] || null;
        }

        if (!wormholeClass && systemInfo && systemInfo.wormholeClass) {
            wormholeClass = (systemInfo.wormholeClass || '').toUpperCase();
            classColor = classColors[wormholeClass] || null;
        }

        if (!wormholeClass && systemInfo && systemInfo.security_status !== undefined) {
            const secStatus = systemInfo.security_status;
            if (secStatus >= 0.5) {
                wormholeClass = 'HS';
            } else if (secStatus >= 0.1) {
                wormholeClass = 'LS';
            } else {
                wormholeClass = 'NS';
            }
            classColor = classColors[wormholeClass] || classColor;
        }

        if (!classColor && wormholeClass) {
            classColor = classColors[wormholeClass] || classColor;
        }

        if (wormholeClass && (!d.wormholeClass || d.wormholeClass.toUpperCase() !== wormholeClass)) {
            d.wormholeClass = wormholeClass;
        }

        const nicknameKey = d.filterKey || d.name;
        const nickname = typeof window.getSystemNickname === 'function' ? window.getSystemNickname(nicknameKey) : '';
        const displayName = d.displayName || d.name;
        const classPart = wormholeClass ? `${wormholeClass.toUpperCase()} ` : '';
        const baseLabel = `${classPart}${displayName}`;
        d._baseLabel = baseLabel;
        d.nickname = nickname;

        const labels = [];
        const primaryLabel = nickname ? `${baseLabel} (${nickname})` : baseLabel;
        labels.push({ text: primaryLabel, color: classColor });

        if (systemInfo && systemInfo.statics && !d.isPlaceholder) {
            Object.entries(systemInfo.statics).forEach(([staticName, staticInfo]) => {
                const staticClass = staticInfo && staticInfo.class ? staticInfo.class.toUpperCase() : '';
                const staticColor = staticClass ? (classColors[staticClass] || '#00ff00') : '#00ff00';
                const staticLabel = staticClass ? `${staticClass} ${staticName}` : staticName;
                labels.push({ text: staticLabel, color: staticColor });
            });
        }

        labels.forEach((label, index) => {
            const textClass = index === 0 ? "label label-primary" : "label";
            const text = g.append("text")
                .attr("class", textClass)
                .attr("fill", label.color || '#00ff00')
                .attr("font-size", index === 0 ? "12px" : "9.6px") // Scale down statics labels by 20%
                .attr("text-anchor", "middle")
                .attr("dy", `${-2 - index * 2.4}em`) // Remove gap between static tags
                .text(label.text);

            if (index > 1) {
                text.attr("dy", `${-2 - index * 2}em`) // Remove gap between static tags
            }

            const bbox = text.node().getBBox();

            const rectClass = index === 0 ? "label-rect label-rect-primary" : "label-rect";
            g.insert("rect", "text")
                .attr("class", rectClass)
                .attr("fill", label.color || '#121212')
                .attr("stroke", label.color || '#00ff00')
                .attr("stroke-width", 1)
                .attr("x", bbox.x - 4)
                .attr("y", bbox.y - 2)
                .attr("width", bbox.width + 8)
                .attr("height", bbox.height + 4);
        });

        function selectSystem() {
            const systemName = d.filterKey || d.name;
            console.log(`System ${systemName} selected`);
            let handled = false;
            if (typeof window.__bookmarkViewerApplySystemSelection === 'function') {
                handled = window.__bookmarkViewerApplySystemSelection(systemName) === true;
            }
            if (!handled) {
                filterBookmarksBySystem(systemName);
            }
        }

        g.on("click", function(event) {
            selectSystem();
        });

        // Remove the drag behavior
        // g.call(d3.drag()
        //     .on("start", function(event) {
        //         d3.select(this).raise().classed("active", true);
        //     })
        //     .on("drag", function(event) {
        //         d3.select(this).attr("transform", `translate(${event.x},${event.y})`);
        //         selectSystem();
        //     })
        //     .on("end", function(event) {
        //         d3.select(this).classed("active", false);
        //     })
        // );
    });
}

function filterBookmarksBySystem(systemName) {
    // Implement the logic to filter bookmarks based on the selected system
    console.log(`Filtering bookmarks for system: ${systemName}`);
    // Example: Update the table or map based on the selected system
}
