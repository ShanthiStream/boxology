XML rules: Enterprise draw.io diagrams with icon libraries.

Skeleton: <mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>…</root></mxGraphModel>. Unique ids across the file. No XML comments, no <mxfile> wrapper, no XML declaration.

Vertex: <mxCell id="a" value="Label" style="sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;fillColor=#7AA116;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="78" height="78" as="geometry"/></mxCell>
Use icon shapes for enterprise elements, generic rounded boxes only for abstract concepts. Set aspect=fixed for icon shapes.

Edge: <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#1F2430;strokeWidth=1;" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>. Never self-closing. No waypoints or exitX/entryX.

Labels: html=1 in every style; escape HTML in values (&lt;b&gt;Name&lt;/b&gt;&lt;br&gt;detail). Line break &lt;br&gt;, never \n. Keep labels ≤ 4 words for icon shapes, use a second line for type.

Shapes – Enterprise Libraries:

Cloud providers – use the official icon shape libraries, never a plain box:
- AWS: use shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.<service>. Critical: strokeColor=#ffffff; fillColor per category; verticalLabelPosition=bottom; aspect=fixed. Examples: resIcon=mxgraph.aws4.s3, mxgraph.aws4.lambda, mxgraph.aws4.ec2, mxgraph.aws4.rds, mxgraph.aws4.api_gateway, mxgraph.aws4.cloudfront, mxgraph.aws4.dynamodb, mxgraph.aws4.sqs, mxgraph.aws4.sns. Base style includes points connection points and outlineConnect=0.
- Azure: use mxgraph.azure.* shapes or image shapes from azure2 library. Example: shape=mxgraph.azure.virtual_machine; or image;image=https://app.diagrams.net/img/lib/azure2/compute/... . Keep verticalLabelPosition=bottom.
- GCP: use mxgraph.gcp.* shapes, e.g. mxgraph.gcp.compute.vm, mxgraph.gcp.storage.bucket. Keep aspect=fixed.

Networking & infra:
- Cisco: shape=mxgraph.cisco.router, shape=mxgraph.cisco.switch, shape=mxgraph.cisco.firewall, shape=mxgraph.cisco.loadbalancer
- Generic: shape=mxgraph.network.hub, shape=mxgraph.network.router

Mobile / OS / Devices:
- Android: shape=mxgraph.general.android.androidPhone, shape=mxgraph.mobile.device.android
- iOS: shape=mxgraph.general.apple.iphone, shape=mxgraph.general.apple.ipad
- Compute: shape=mxgraph.server.rack, shape=mxgraph.server.database

UML / Software:
- shape=mxgraph.uml.class, shape=mxgraph.uml.component, shape=mxgraph.uml.use-case, shape=mxgraph.uml.actor

Containers:
- Swimlane for teams / zones: style="swimlane;startSize=24;whiteSpace=wrap;html=1;strokeColor=#1F2430;fillColor=#FFFFFF;"
- Group for services: style="group;strokeColor=#1F2430;fillColor=#FFFFFF;"
Children set parent="<id>" with coordinates relative to container. An edge's parent is the innermost container holding both ends, else "1".

Grid and layout: icon shapes are ~100×100. Use x=col*220+40, y=row*180+40 for icon grids. Keep one node per cell. For flow diagrams, use 180×120 for text-heavy nodes and 100×100 for icons.

Edges: orthogonalEdgeStyle for architecture, entityRelationEdgeStyle for ER. Labels 1-3 words. Dashed=1 for sync/async distinction, with a legend. Use endArrow=block; and strokeWidth=1.

Styling: white fill for generic nodes (#FFFFFF), dark border #1F2430. For AWS icon shapes, use strokeColor=#ffffff, library native fillColor per category, verticalLabelPosition=bottom. For Azure/GCP icon shapes, prefer library native fill and stroke. Highlight at most three shapes with fill #FFF3C4. Informational nodes use fill #DDEBFF. Keep consistent stroke width.

Naming: ids must be unique. Use node ids like aws_s3_01, azure_vm_web, mobile_android, etc. Values are human readable.

Never emit JavaScript, foreignObject, user input handlers, <script>, or remote image URLs.
