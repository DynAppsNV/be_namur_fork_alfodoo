/** @odoo-module **/

/* ---------------------------------------------------------
+ * Odoo cmis_web
+ * Authors Laurent Mignon 2016, Quentin Groulard 2023 Acsone SA/NV
+ * License in __openerp__.py at root level of the module
+ *---------------------------------------------------------
+*/

import {CmisActions} from "@cmis_web/cmis_actions/cmis_actions";
import {patch} from "@web/core/utils/patch";
import { rpc } from "@web/core/network/rpc";

patch(CmisActions.prototype, {
    async onClickOpenInAlf(ev) {
        ev.stopPropagation();
        const url = await rpc("/web/cmis/content_details_url", {
            backend_id: 1,
            cmis_objectid: this.props.cmisObject.objectId,
        });
        window.open(url);
    },
});

CmisActions.props.openInAlf = Function;
