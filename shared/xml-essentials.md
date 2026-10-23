XML rules: Enterprise draw.io diagrams with icon libraries.

Skeleton: <mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>…</root></mxGraphModel>. Unique ids across the file. No XML comments, no <mxfile> wrapper, no XML declaration.

Vertex: <mxCell id="a" value="Label" style="shape=mxgraph.aws4.s3;whiteSpace=wrap;html=1;strokeColor=#1F2430;strokeWidth=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="100" height="100" as="geometry"/></mxCell>
Use icon shapes for enterprise elements, generic rounded boxes only for abstract concepts. Set aspect=fixed for icon shapes.

Edge: <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#1F2430;strokeWidth=1;" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>. Never self-closing. No waypoints or exitX/entryX.

Labels: html=1 in every style; escape HTML in values (&lt;b&gt;Name&lt;/b&gt;&lt;br&gt;detail). Line break &lt;br&gt;, never \n. Keep labels ≤ 4 words for icon shapes, use a second line for type.

Shapes – Enterprise Libraries:

Cloud providers – use the official icon shape libraries, never a plain box:
- AWS: shape=mxgraph.aws4.s3, shape=mxgraph.aws4.lambda, shape=mxgraph.aws4.ec2, shape=mxgraph.aws4.rds, shape=mxgraph.aws4.api_gateway, shape=mxgraph.aws4.cloudfront, shape=mxgraph.aws4.dynamodb, shape=mxgraph.aws4.sqs, shape=mxgraph.aws4.sns, shape=mxgraph.aws4.vpc, shape=mxgraph.aws4.route53. Stroke #232F3E.
- Azure: shape=mxgraph.azure.azure.compute.vm, shape=mxgraph.azure.azure.storage.storageaccount, shape=mxgraph.azure.azure.database.postgresql, shape=mxgraph.azure.azure.servicebus, shape=mxgraph.azure.azure.functions, shape=mxgraph.azure.azure.api_management, shape=mxgraph.azure.azure.network.vnet, shape=mxgraph.azure.azure.network.loadbalancer.
- GCP: shape=mxgraph.gcp.compute.vm, shape=mxgraph.gcp.storage.bucket, shape=mxgraph.gcp.database.cloudsql, shape=mxgraph.gcp.functions.function, shape=mxgraph.gcp.api.gateway, shape=mxgraph.gcp.network.vpc.

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

Styling: white fill for generic nodes (#FFFFFF), dark border #1F2430. For icon shapes, prefer the library's native fill and keep stroke #1F2430. Highlight at most three shapes with fill #FFF3C4. Informational nodes use fill #DDEBFF. Keep consistent stroke width.

Naming: ids must be unique. Use node ids like aws_s3_01, azure_vm_web, mobile_android, etc. Values are human readable.

Never emit JavaScript, foreignObject, user input handlers, <script>, or remote image URLs.
