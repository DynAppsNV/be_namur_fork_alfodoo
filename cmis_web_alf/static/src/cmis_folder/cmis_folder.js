// /** @odoo-module **/
//
// /* ---------------------------------------------------------
// + * Odoo cmis_web
// + * Authors Laurent Mignon 2016, Quentin Groulard 2023 Acsone SA/NV
// + * License in __openerp__.py at root level of the module
// + *---------------------------------------------------------
// +*/
//
import {CmisFolderField} from "@cmis_web/cmis_folder/cmis_folder";
import {patch} from "@web/core/utils/patch";
import { rpc } from "@web/core/network/rpc";
//
patch(CmisFolderField.prototype, {

    onClickOpenInAlf() {
        this.openInAlf(this.displayFolderId);
    },

    async openInAlf(cmisObjectId) {
        const url = await rpc("/web/cmis/content_details_url", {
            backend_id: this.backend_cmis.id,
            cmis_objectid: cmisObjectId,
        });
        window.open(url);
    },

    getCmisObjectWrapperParams() {
        if (!this.params){
            this.params = this.backend_cmis;
            this.params.alfrescoApiLocation = this.backend_cmis?.alfresco_api_location
        }else{
            this.params.alfrescoApiLocation = this.backend_cmis?.alfresco_api_location || '';
        }
        return this.params;
    },
});

CmisFolderField.props.backend_cmis.shape.share_location = String;
CmisFolderField.props.backend_cmis.shape.alfresco_api_location = String;
