function cG = calculateCentreOfGravity( part )

% -----------------------------------------------------------------------------------------------------------------
% cG = calculateCentreOfGravity( part )
%
% Determines the diameter of the evolving Sphere for the current
% agglomerate size
% 
% Input data:
% part:     Matrix with centres and radius of particles composing the
%           agglomerate.
% i:        Current iteration number (particle to be added)
% cG:       Centre of gravity of the agglomerate
%
% Output data:
% cG:       Centre of gravity of the agglomerate
%
% -----------------------------------------------------------------------------------------------------------------

%% Calculate the new centre of gravity of the agglomerate
if iscell( part )
    part = cell2mat( part );
    part = part( :, 3 : 6 );
end

denominador = sum( 8 * part( 1 : end, 4 ) .^ 3 );
cG( 1 ) = sum( part( 1 : end, 1 ) .* ( 8 * part( 1 : end, 4 ) .^ 3 ) ) / denominador;
cG( 2 ) = sum( part( 1 : end, 2 ) .* ( 8 * part( 1 : end, 4 ) .^ 3 ) ) / denominador;
cG( 3 ) = sum( part( 1 : end, 3 ) .* ( 8 * part( 1 : end, 4 ) .^ 3 ) )/ denominador;
