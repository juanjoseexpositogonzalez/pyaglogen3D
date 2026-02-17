for r = 1 : size( referencias, 1 )
    np( r ) = r;
    rg( r ) = referencias{r}{2}(2,4);
end
nplog10 = log10( np( 3: end ) );
rglog10 = log10( rg( 3 : end ) );
plot( nplog10, rglog10 );

p = polyfit( nplog10, rglog10, 1 );

Df = exp( p( 1 ) );
kf = p( 2 );