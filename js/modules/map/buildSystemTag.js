import { loadSystemsData } from '/bookmark-viewer/js/loadSystemsData.js'; // Corrected path

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
    "C13": "#7F7F7F"
};

export async function buildSystemTag(selection) {
    const systemsData = await loadSystemsData();

    selection.each(function(d) {
        const g = d3.select(this);
        const systemInfo = systemsData[d.name];
        let wormholeClass = systemInfo ? systemInfo.wormholeClass : null;
        let classColor = wormholeClass ? classColors[wormholeClass.toUpperCase()] : null;

        if (!wormholeClass && systemInfo && systemInfo.security_status !== undefined) {
            const secStatus = systemInfo.security_status;
            if (secStatus >= 0.5) {
                wormholeClass = 'HS';
            } else if (secStatus >= 0.1) {
                wormholeClass = 'LS';
            } else {
                wormholeClass = 'NS';
            }
            classColor = classColors[wormholeClass];
        }

        const labels = [];
        labels.push({ text: `${wormholeClass ? wormholeClass.toUpperCase() : ''} ${d.name}`, color: classColor });

        if (systemInfo && systemInfo.statics) {
            Object.entries(systemInfo.statics).forEach(([staticName, staticInfo]) => {
                const staticColor = classColors[staticInfo.class.toUpperCase()] || '#00ff00';
                labels.push({ text: staticName, color: staticColor });
            });
        }

        labels.forEach((label, index) => {
            const text = g.append("text")
                .attr("class", "label")
                .attr("fill", label.color || '#00ff00')
                .attr("font-size", index === 0 ? "12px" : "9.6px") // Scale down statics labels by 20%
                .attr("text-anchor", "middle")
                .attr("dy", `${-2 - index * 2.4}em`) // Remove gap between static tags
                .text(label.text);

            if (index > 1) {
                text.attr("dy", `${-2 - index * 2}em`) // Remove gap between static tags
            }

            const bbox = text.node().getBBox();

            g.insert("rect", "text")
                .attr("class", "label-rect")
                .attr("fill", label.color || '#121212')
                .attr("stroke", label.color || '#00ff00')
                .attr("stroke-width", 1)
                .attr("x", bbox.x - 4)
                .attr("y", bbox.y - 2)
                .attr("width", bbox.width + 8)
                .attr("height", bbox.height + 4);
        });

        function selectSystem() {
            const systemName = d.name;
            console.log(`System ${systemName} selected`);
            filterBookmarksBySystem(systemName);
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