/** @odoo-module **/

/* ---------------------------------------------------------
+ * Odoo cmis_web
+ * Authors Laurent Mignon 2016, Quentin Groulard 2023 Acsone SA/NV
+ * License in __openerp__.py at root level of the module
+ *---------------------------------------------------------
+*/

import {CmisObjectWrapper} from "@cmis_web/cmis_object_wrapper_service";
import {patch} from "@web/core/utils/patch";

patch(CmisObjectWrapper.prototype, {
    setup(cmisObject, cmisSession, params) {
        this.alfrescoApiLocation = params.alfrescoApiLocation;
    },

    getPreviewUrl() {
        const base = "/cmis/proxy/";
        const objectId = encodeURIComponent(this.objectId || this.versionSeriesId);

        return `${base}root?cmisselector=content&objectId=${objectId}&download=attachment`;
    },
});
